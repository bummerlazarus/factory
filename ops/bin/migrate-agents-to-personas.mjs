#!/usr/bin/env node
// Backfill public.agent_personas from public.agents (identity_md / claude_md / soul_md).
// Idempotent: skips on (agent_id, kind, version=1) conflict.
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node ops/bin/migrate-agents-to-personas.mjs
// Or relies on dashboard/.env.local being loaded by the caller.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv() {
  const path = join(process.cwd(), "dashboard", ".env.local");
  try {
    const txt = readFileSync(path, "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v.replace(/^['"]|['"]$/g, "");
    }
  } catch {}
}
loadEnv();

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: agents, error } = await sb
  .from("agents")
  .select("id,identity_md,claude_md,soul_md");
if (error) throw error;
console.log(`Found ${agents.length} agents`);

const rows = [];
const APPROVED_BY = "migration-2026-05-03";
for (const a of agents) {
  const diskPath = `/Users/edmundmitchell/factory/CEO cowork/agent personalities/agents/${a.id}/`;
  const parts = [
    ["identity", a.identity_md],
    ["claude", a.claude_md],
    ["soul", a.soul_md],
  ];
  for (const [kind, body] of parts) {
    if (!body || !body.trim()) continue;
    rows.push({
      agent_id: a.id,
      kind,
      version: 1,
      body,
      status: "live",
      approved_at: new Date().toISOString(),
      approved_by: APPROVED_BY,
      canonical_disk_path: diskPath,
      source_refs: [{ source: "public.agents", column: `${kind}_md` }],
    });
  }
}

console.log(`Inserting ${rows.length} persona rows (upsert ignore-on-conflict)`);
const { error: upErr, count } = await sb
  .from("agent_personas")
  .upsert(rows, { onConflict: "agent_id,kind,version", ignoreDuplicates: true, count: "exact" });
if (upErr) throw upErr;
console.log(`Inserted/skipped: ${count ?? rows.length}`);

const { data: check } = await sb
  .from("agent_personas")
  .select("agent_id,kind", { count: "exact" })
  .eq("status", "live");
console.log(`Total live persona rows now: ${check?.length ?? 0}`);
