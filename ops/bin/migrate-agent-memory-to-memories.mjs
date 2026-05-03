#!/usr/bin/env node
// Best-effort migration of public.agent_memory (legacy 3 free-text files per agent)
// to public.agent_memories (typed, named curated entries).
//
// Strategy: split each `learnings` / `decisions` blob on `\n## YYYY-MM-DD[T...]\n`
// headings; emit one agent_memories row per non-empty chunk.
// `context` files are skipped (no clean entry boundary).
//
// Idempotent: ON CONFLICT (agent_id, name, version=1) DO NOTHING.
// agent_id mapping: legacy `axel` → `developer` (and any other future divergence).
//
// In practice this was executed once in-place via SQL on 2026-05-03.
// This script preserves a re-runnable record. Pass --execute to actually run it
// against $SUPABASE_URL with $SUPABASE_SERVICE_ROLE_KEY.
//
// Usage:
//   node ops/bin/migrate-agent-memory-to-memories.mjs --execute

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv() {
  try {
    const txt = readFileSync(join(process.cwd(), "dashboard", ".env.local"), "utf8");
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
if (!url || !key) { console.error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const execute = process.argv.includes("--execute");
const sb = createClient(url, key, { auth: { persistSession: false } });

const ID_REMAP = { axel: "developer" };
const TYPE_FROM = { learnings: "feedback", decisions: "project" };
const HEADING_RE = /\n## \d{4}-\d{2}-\d{2}[T ][^\n]*\n/;

const { data: legacy, error } = await sb
  .from("agent_memory")
  .select("agent_id,file_type,content")
  .in("file_type", ["learnings", "decisions"]);
if (error) throw error;

const rows = [];
for (const r of legacy) {
  const agentId = ID_REMAP[r.agent_id] ?? r.agent_id;
  const type = TYPE_FROM[r.file_type];
  const chunks = r.content.split(HEADING_RE);
  chunks.forEach((raw, idx) => {
    const text = raw.trim();
    if (!text) return;
    const firstLine = text.split("\n", 1)[0] ?? "";
    const slug = firstLine.slice(0, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const name = `${slug}-${r.file_type}-${idx + 1}`.replace(/^-+|-+$/g, "");
    rows.push({
      agent_id: agentId,
      name,
      description: firstLine.slice(0, 200),
      type,
      body: text,
      version: 1,
      status: "live",
      created_by: "human",
      source_refs: [{ source: "public.agent_memory", file_type: r.file_type, chunk_idx: idx + 1, migration: "2026-05-03" }],
    });
  });
}

console.log(`Prepared ${rows.length} agent_memories rows`);
if (!execute) { console.log("(dry run — pass --execute to upsert)"); process.exit(0); }

const { error: upErr } = await sb
  .from("agent_memories")
  .upsert(rows, { onConflict: "agent_id,name,version", ignoreDuplicates: true });
if (upErr) throw upErr;
console.log(`Upserted (idempotent).`);
