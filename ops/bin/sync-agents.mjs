#!/usr/bin/env node
// sync-agents.mjs — push agent definitions from disk to public.agents.
//
// Disk = source of truth. DB = derived runtime cache.
// Convention: ops/docs/agent-source-of-truth.md
//
// Reads $COWORK_PATH/agent personalities/agents/<id>/{identity,CLAUDE,soul}.md
// and UPSERTs into public.agents keyed on id (= directory name).
//
// Idempotent: skips agents whose disk content already matches the DB row.
//
// Requires in env (loaded from /Users/edmundmitchell/factory/ops/.env if present):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   COWORK_PATH (or falls back to dashboard/.env.local value)
//
// Usage:
//   node ops/bin/sync-agents.mjs            # all agents
//   node ops/bin/sync-agents.mjs cordis     # one agent

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const FACTORY_ROOT = join(SCRIPT_DIR, "..", "..");

// ── env loading ─────────────────────────────────────────────────────────
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}
loadEnvFile(join(FACTORY_ROOT, "ops", ".env"));
loadEnvFile(join(FACTORY_ROOT, "dashboard", ".env.local"));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COWORK_PATH = process.env.COWORK_PATH;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!COWORK_PATH) {
  console.error("Missing COWORK_PATH (set in ops/.env or dashboard/.env.local)");
  process.exit(1);
}

const AGENTS_DIR = join(COWORK_PATH, "agent personalities", "agents");
if (!existsSync(AGENTS_DIR)) {
  console.error(`Agents directory not found: ${AGENTS_DIR}`);
  process.exit(1);
}

// ── identity.md parser ──────────────────────────────────────────────────
// Identity files use **Field:** value lines, not YAML frontmatter.
function parseIdentity(text) {
  const out = {};
  const grab = (label) => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };
  out.name = grab("Name");
  out.role = grab("Role");
  out.emoji = grab("Emoji");
  // Accent Color often "Indigo (#6366F1)" — extract the hex.
  const accent = grab("Accent Color");
  if (accent) {
    const hex = accent.match(/#[0-9A-Fa-f]{3,8}/);
    out.accent_color = hex ? hex[0] : accent;
  }
  return out;
}

// ── PostgREST client ────────────────────────────────────────────────────
const pgHeaders = {
  apikey: SERVICE_KEY,
  authorization: `Bearer ${SERVICE_KEY}`,
  "content-type": "application/json",
};

async function fetchAgent(id) {
  const url = `${SUPABASE_URL}/rest/v1/agents?id=eq.${encodeURIComponent(id)}&select=id,name,role,emoji,accent_color,identity_md,claude_md,soul_md`;
  const res = await fetch(url, { headers: pgHeaders });
  if (!res.ok) throw new Error(`fetch ${id}: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

async function upsertAgent(payload) {
  const url = `${SUPABASE_URL}/rest/v1/agents?on_conflict=id`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...pgHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`upsert ${payload.id}: ${res.status} ${await res.text()}`);
}

// ── per-agent sync ──────────────────────────────────────────────────────
function readAgentFromDisk(id) {
  const dir = join(AGENTS_DIR, id);
  const identityPath = join(dir, "identity.md");
  const claudePath = join(dir, "CLAUDE.md");
  const soulPath = join(dir, "soul.md");
  if (!existsSync(identityPath)) {
    throw new Error(`identity.md missing in ${dir}`);
  }
  if (!existsSync(claudePath)) {
    throw new Error(`CLAUDE.md missing in ${dir}`);
  }
  const identityText = readFileSync(identityPath, "utf8");
  const meta = parseIdentity(identityText);
  if (!meta.name) throw new Error(`identity.md ${dir}: missing Name field`);
  return {
    id,
    name: meta.name,
    role: meta.role ?? "",
    emoji: meta.emoji ?? "🤖",
    accent_color: meta.accent_color ?? "#888888",
    identity_md: identityText,
    claude_md: readFileSync(claudePath, "utf8"),
    soul_md: existsSync(soulPath) ? readFileSync(soulPath, "utf8") : null,
  };
}

function rowsEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.name === b.name &&
    a.role === b.role &&
    a.emoji === b.emoji &&
    a.accent_color === b.accent_color &&
    a.identity_md === b.identity_md &&
    a.claude_md === b.claude_md &&
    (a.soul_md ?? null) === (b.soul_md ?? null)
  );
}

async function syncOne(id) {
  let payload;
  try {
    payload = readAgentFromDisk(id);
  } catch (err) {
    console.log(`✗ ${id} — disk error: ${err.message}`);
    return { status: "error" };
  }
  let existing;
  try {
    existing = await fetchAgent(id);
  } catch (err) {
    console.log(`✗ ${id} — fetch error: ${err.message}`);
    return { status: "error" };
  }
  if (rowsEqual(existing, payload)) {
    console.log(`= ${id} — unchanged`);
    return { status: "unchanged" };
  }
  try {
    await upsertAgent(payload);
    console.log(`✓ ${id} — synced (${payload.claude_md.length} chars CLAUDE.md)`);
    return { status: "synced" };
  } catch (err) {
    console.log(`✗ ${id} — upsert error: ${err.message}`);
    return { status: "error" };
  }
}

// ── main ────────────────────────────────────────────────────────────────
async function main() {
  const arg = process.argv[2];
  let ids;
  if (arg) {
    ids = [arg];
  } else {
    ids = readdirSync(AGENTS_DIR).filter((name) => {
      const p = join(AGENTS_DIR, name);
      return statSync(p).isDirectory() && existsSync(join(p, "identity.md"));
    });
  }
  console.log(`Syncing ${ids.length} agent(s) from ${AGENTS_DIR} → ${SUPABASE_URL}`);
  const counts = { synced: 0, unchanged: 0, error: 0 };
  for (const id of ids.sort()) {
    const r = await syncOne(id);
    counts[r.status]++;
  }
  console.log(`\nDone. synced=${counts.synced} unchanged=${counts.unchanged} error=${counts.error}`);
  process.exit(counts.error > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
