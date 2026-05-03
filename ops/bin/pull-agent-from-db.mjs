#!/usr/bin/env node
// pull-agent-from-db.mjs — copy a single agent's row from public.agents back
// to disk. Recovery tool for when someone edited the DB directly and the
// disk version is stale. Run BEFORE sync-agents.mjs (which would otherwise
// overwrite the DB row with the stale disk version).
//
// See ops/docs/agent-source-of-truth.md.
//
// Usage:
//   node ops/bin/pull-agent-from-db.mjs <agent-id>

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const FACTORY_ROOT = join(SCRIPT_DIR, "..", "..");

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

const id = process.argv[2];
if (!id) {
  console.error("usage: pull-agent-from-db.mjs <agent-id>");
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COWORK_PATH = process.env.COWORK_PATH;

if (!SUPABASE_URL || !SERVICE_KEY || !COWORK_PATH) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / COWORK_PATH");
  process.exit(1);
}

const url = `${SUPABASE_URL}/rest/v1/agents?id=eq.${encodeURIComponent(id)}&select=id,identity_md,claude_md,soul_md`;
const res = await fetch(url, {
  headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
});
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const rows = await res.json();
if (rows.length === 0) {
  console.error(`no agent row for id=${id}`);
  process.exit(1);
}
const row = rows[0];

const dir = join(COWORK_PATH, "agent personalities", "agents", id);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "identity.md"), row.identity_md ?? "");
writeFileSync(join(dir, "CLAUDE.md"), row.claude_md ?? "");
if (row.soul_md != null) {
  writeFileSync(join(dir, "soul.md"), row.soul_md);
}
console.log(`✓ pulled ${id} → ${dir}`);
console.log(`  identity.md ${(row.identity_md ?? "").length} chars`);
console.log(`  CLAUDE.md   ${(row.claude_md ?? "").length} chars`);
console.log(`  soul.md     ${row.soul_md != null ? `${row.soul_md.length} chars` : "(no row, file untouched)"}`);
