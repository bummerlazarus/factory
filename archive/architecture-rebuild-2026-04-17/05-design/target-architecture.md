# Target Architecture

Living document. Starting point: CEO Desk handoff 2026-04-17 (preserved below).
Revisions should be dated in the "Changes" section at the bottom.

---

## The three-system picture (high level)

| Goal | System | Home |
|---|---|---|
| **Personal database** | Durable memory + corpus + structured ops | Supabase (rows, blobs, maybe pgvector) + Pinecone (until Q2) + Notion (ops source-of-truth for Work/Creator Engine/CEO Desk Sessions/etc.) |
| **Multi-agent workflows** | Specialist agents coordinating through shared brain | Claude as runtime (no custom). New dashboard UI on Vercel. Agents = system prompts + tool allowlists + per-agent memory in Supabase |
| **One inbox** | Unified dumping ground for text / files / prompts / URLs | Single `capture()` Edge Function. Three entry points: Claude chat, dashboard `/inbox`, public webhook URL. Supabase Realtime bridges everything live |

See `05-design/dashboard-architecture.md` for the inbox + dashboard detail.

## Five pillars → architecture mapping

Edmund's priorities (from `01-context/vision-and-priorities.md`) map to the tech layers like this:

| Pillar | Implementation |
|---|---|
| **1. Rich data capture first** | New Supabase tables for sessions, chat history, work logs, token usage. `capture()` Edge Function is the write path. Schema-expansion is Phase 1.5 (between dead-weight delete and the collapse-to-MCP phase). |
| **2. One source of truth** | Goals/values/KPIs/framework docs consolidate into Supabase-backed "reference" tables. Notion surfaces them. All agents read from the same canonical store. |
| **3. SOPs as Skills** | Each repeatable approach (voice/tone, content planning, lead magnets) becomes a versioned Skill in `/skills/<topic>/`. Skills carry metadata declaring which MCP tools and reference docs they depend on. |
| **4. Self-improving / recursive learning loops** | Agents write observations to a `promotions` table (or similar) → higher-level Skill updates pull from it. Ingested content (books, podcasts, client work) gets scored for relevance and optionally auto-merged into the Skill's reference set. |
| **5. Proactive surfacing** | Claude scheduled tasks run daily/weekly Skills that read the personal database and surface prompts, prioritization, nudges to Notion and the dashboard. Daily briefing is the baseline — the goal is smarter observation agents. |

---

## Layers

- **Data — Supabase**
  - Postgres: structured rows, logs, pointers
  - Storage: blobs (PDFs, images, audio, long markdown)
  - Edge Functions: unique business logic (including `capture()`)
  - Realtime: bridges chat / dashboard / webhook writes live
  - pgvector: available, not yet primary (Q2)
- **Data — Pinecone**
  - Archival vector search (replaceable; architect for swap — Q2)
- **Surface — Notion**
  - Source of truth for ops flows (Work DB, Creator Engine, CEO Desk Sessions, SOPs, Meetings, Pitches, Swipe Files, Podcast Outreach, People, Organizations, Strategies)
  - Native MCP only; no custom Notion sync tools
- **Surface — Dashboard** (`/dashboard/` in monorepo — the former local prototype, now the production app)
  - Agent sidebar, streaming chat, workspace, inbox, activity log
  - Filesystem I/O being replaced with Supabase (migration plan: `/dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md`)
  - Backed by Supabase; subscribes to Realtime for live updates
  - See `dashboard-architecture.md`
- **Agent — Claude**
  - Web / iPhone / desktop / Code
  - No custom runtime
  - Writes via native MCPs and the `capture()` Edge Function

## Target repo

```
/supabase    schema, migrations, RLS, edge functions
/pinecone    index config, ingestion (replaceable)
/skills      Claude Skills (portable markdown + scripts)
/agents      system prompts, tool allowlists, project configs
/dashboard   separate Next.js app on Vercel, read-only
/ops         env, keys, one-time scripts, README
```

**Invariant:** no Python scripts, CLIs, MCP servers, or API keys living alongside agent configs.

## Tool destinations (summary)

See `migration-plan.md` for the full matrix.

| Destination | Tools |
|---|---|
| Native Supabase MCP | `get_core_facts`, `save_core_fact`, `forget_core_fact`, `get_recent_messages`, `get_recent_activity`, `save_data`, `query_data` |
| Native Pinecone MCP | `search_memory` |
| Claude Skill + native MCP | `ask_channel`, `ask_priestley`, `ask_hormozi`, `run_meeting`, `suggest_skill` |
| Supabase Edge Function | YouTube ingest/sync, signal ingest, Instagram ingest/publish, voice/PDF/invoice generation, `capture_thought` dual-write |
| Claude platform (scheduled tasks) | `daily_briefing`, `hygiene_report`, `schedule_task` family |
| Native Firecrawl MCP | `firecrawl_scrape` |
| Native Notion MCP | Notion reads/writes |
| Kill (audit first) | `file_reader`, `file_writer`, `publish_to_vault`, `recalibrate_pinecone`, `prune_pinecone_memory`, `update_factory_session`, `system_heartbeat` |

## Vector strategy (current)

Pinecone for now. pgvector available as a future swap. Architect the ingestion layer so the destination is a single swap (not a rewrite).

## Scheduling & automation

- Default: Claude scheduled tasks
- Edge Functions can be triggered by Supabase cron extension for data-layer jobs (ingest, sync) that shouldn't depend on an agent session
- No Railway, no custom cron containers

## Changes

_Date-stamp revisions here._

- **2026-04-17** — Initial seed from CEO Desk handoff.
- **2026-04-17** — Added three-system picture. Reframed dashboard: new Vercel+Supabase build, not the local prototype. Added inbox-as-pipeline + Realtime bridge. Noted Notion's role as ops source-of-truth (not a view). References new doc `dashboard-architecture.md`.
