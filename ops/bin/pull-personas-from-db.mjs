#!/usr/bin/env node
// pull-personas-from-db.mjs — DB→disk pull for the per-agent prompt parts.
//
// Source of truth is now public.agent_personas. This script writes the latest
// status='live' persona for each non-archived agent to:
//   $COWORK_PATH/agent personalities/agents/<id>/{identity.md,CLAUDE.md,soul.md}
//
// Refuses to overwrite a file whose mtime is newer than the corresponding DB
// row's approved_at — instead writes an `observations` row tagged
// persona_drift and exits 2.
//
// Flags:
//   --dry-run       show what would change, write nothing
//   --agent <id>    restrict to one agent
//
// Env (loaded from dashboard/.env.local + ops/.env if present):
//   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   COWORK_PATH

import {
  readFileSync, writeFileSync, existsSync, statSync, mkdirSync,
} from "node:fs";
import { join } from "node:path";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const FACTORY_ROOT = join(SCRIPT_DIR, "..", "..");

function loadEnvFile(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (!process.env[k]) process.env[k] = v.replace(/^['"]|['"]$/g, "");
  }
}
loadEnvFile(join(FACTORY_ROOT, "ops", ".env"));
loadEnvFile(join(FACTORY_ROOT, "dashboard", ".env.local"));

const URL_BASE = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COWORK = process.env.COWORK_PATH;
if (!URL_BASE || !KEY) { console.error("Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
if (!COWORK) { console.error("Missing COWORK_PATH"); process.exit(1); }

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run") || args.has("-n");
const agentArgIdx = process.argv.indexOf("--agent");
const onlyAgent = agentArgIdx > -1 ? process.argv[agentArgIdx + 1] : null;

async function rest(path, opts = {}) {
  const headers = {
    apikey: KEY,
    authorization: `Bearer ${KEY}`,
    "content-type": "application/json",
    ...(opts.headers || {}),
  };
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...opts, headers });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

const KIND_TO_FILE = { identity: "identity.md", claude: "CLAUDE.md", soul: "soul.md" };

const agents = await rest("agents?select=id&archived=eq.false&order=sort_order.asc");

let drifted = 0, wrote = 0, skipped = 0;

for (const a of agents) {
  if (onlyAgent && a.id !== onlyAgent) continue;
  const parts = await rest(
    `agent_personas?select=kind,body,approved_at,version&agent_id=eq.${encodeURIComponent(a.id)}&status=eq.live`
  );
  if (!parts || parts.length === 0) {
    console.warn(`[${a.id}] no live personas — skipped`);
    continue;
  }
  const dir = join(COWORK, "agent personalities", "agents", a.id);
  if (!existsSync(dir)) {
    if (dryRun) { console.log(`[${a.id}] would mkdir ${dir}`); continue; }
    mkdirSync(dir, { recursive: true });
  }
  for (const p of parts) {
    const filename = KIND_TO_FILE[p.kind];
    if (!filename) continue;
    const target = join(dir, filename);
    const approvedMs = p.approved_at ? new Date(p.approved_at).getTime() : 0;
    if (existsSync(target)) {
      const existing = readFileSync(target, "utf8");
      if (existing === p.body) { skipped++; continue; }
      const mtime = statSync(target).mtimeMs;
      if (mtime > approvedMs) {
        drifted++;
        console.warn(`[${a.id}/${p.kind}] DRIFT: disk newer than DB approved_at — refusing to overwrite`);
        if (!dryRun) {
          await rest("observations", {
            method: "POST",
            body: JSON.stringify({
              kind: "risk",
              summary: `Persona disk drift: ${target} is newer than DB approved_at; pull refused.`,
              metadata: {
                drift_type: "persona_drift",
                persona_drift: {
                  agent_id: a.id, kind: p.kind,
                  mtime_disk_iso: new Date(mtime).toISOString(),
                  approved_at_db: p.approved_at,
                },
              },
            }),
          });
        }
        continue;
      }
    }
    if (dryRun) {
      console.log(`[${a.id}/${p.kind}] would write ${target} (${p.body.length} chars, v${p.version})`);
    } else {
      writeFileSync(target, p.body);
      wrote++;
      console.log(`[${a.id}/${p.kind}] wrote ${target} (${p.body.length} chars, v${p.version})`);
    }
  }
}

console.log(`\nSummary: wrote=${wrote} skipped=${skipped} drift=${drifted}${dryRun ? " (dry-run)" : ""}`);
if (drifted > 0) process.exit(2);
