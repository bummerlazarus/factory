#!/usr/bin/env node
// check-persona-disk-drift.mjs — daily drift checker.
//
// For each non-archived agent and each kind (identity/claude/soul):
//   - Load latest status='live' agent_personas row.
//   - Read the corresponding $COWORK_PATH file.
//   - If file exists AND its body differs from DB body → log an observations row
//     tagged metadata.drift_type='persona_drift'.
//   - No auto-fix. Human reads the observation; either runs pull-personas-from-db.mjs
//     or files a kind='persona-edit' proposal.
//
// Intended schedule: daily at 04:00 CT via mcp__scheduled-tasks.
//
// Env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, COWORK_PATH

import { readFileSync, existsSync, statSync } from "node:fs";
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
if (!URL_BASE || !KEY || !COWORK) {
  console.error("Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/COWORK_PATH");
  process.exit(1);
}

async function rest(path, opts = {}) {
  const headers = {
    apikey: KEY,
    authorization: `Bearer ${KEY}`,
    "content-type": "application/json",
    ...(opts.headers || {}),
  };
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...opts, headers });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  const txt = await res.text();
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return txt; }
}

const KIND_TO_FILE = { identity: "identity.md", claude: "CLAUDE.md", soul: "soul.md" };

const agents = await rest("agents?select=id&archived=eq.false");
let driftCount = 0;
const driftRows = [];

for (const a of agents) {
  const parts = await rest(
    `agent_personas?select=kind,body,approved_at&agent_id=eq.${encodeURIComponent(a.id)}&status=eq.live`
  );
  const dir = join(COWORK, "agent personalities", "agents", a.id);
  for (const p of parts ?? []) {
    const filename = KIND_TO_FILE[p.kind];
    if (!filename) continue;
    const target = join(dir, filename);
    if (!existsSync(target)) continue;
    const disk = readFileSync(target, "utf8");
    if (disk === p.body) continue;
    driftCount++;
    const mtime = statSync(target).mtimeMs;
    driftRows.push({
      agent_id: a.id, kind: p.kind, target,
      mtime_iso: new Date(mtime).toISOString(),
      approved_at: p.approved_at,
    });
  }
}

if (driftCount === 0) {
  console.log("OK: no drift");
  process.exit(0);
}

console.warn(`DRIFT: ${driftCount} files diverge from DB`);
for (const d of driftRows) console.warn(`  ${d.agent_id}/${d.kind} disk@${d.mtime_iso} db@${d.approved_at}`);

await rest("observations", {
  method: "POST",
  body: JSON.stringify({
    kind: "risk",
    body: `Persona disk drift: ${driftCount} file(s) diverge from DB.`,
    metadata: {
      drift_type: "persona_drift",
      drift_count: driftCount,
      persona_drift: driftRows,
    },
  }),
});

process.exit(0);
