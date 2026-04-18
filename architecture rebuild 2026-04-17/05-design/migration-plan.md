# Migration Plan

**Status:** Revised 2026-04-17 to fold in findings from three audits:
- `04-audit/2026-04-17-gravityclaw-tool-map.md` (46 tools mapped)
- `04-audit/2026-04-17-supabase-audit.md` (46 tables, 0 edge functions)
- `04-audit/2026-04-17-flags-audit.md` (dead tools, duplicates, broken paths)
- `04-audit/2026-04-17-pinecone-audit.md` (1 index, 14,491 vectors, 8 namespaces)

## Key changes from the audit

1. **Five tools are confirmed dead** (broken write or read paths) — delete, don't migrate.
2. **`publish_to_beehiiv` has a missing implementation file** — runtime ImportError.
3. **`notion_sync` is a stub** returning mock data. Delete.
4. **Three "ask_*" tools + `search_memory`** collapse into one parameterized Pinecone call.
5. **The split server architecture** (`mcp_companion.py` / `mcp_factory.py` / `mcp_business.py`) already exists. `mcp_server.py` is the deprecated monolith still in use.
6. **Supabase has zero Edge Functions deployed.** Clean slate.
7. **pgvector is available but NOT installed** on Supabase. `CREATE EXTENSION vector;` is all it takes.
8. **Supabase holds three mingled product concerns** (agent stack + CMS + ZPM/Real+True). Potential split candidate.
9. **Security holes** surfaced that should be fixed during the rewire (details in Phase 0.5).

---

## Phase 0 — Audit (✅ complete)

All four audits are done. Skip to Phase 0.5.

## Phase 0.5 — Security fixes ✅ COMPLETE (2026-04-17)

All four migrations applied and verified. Details in `03-decisions/decisions-log.md` entry "Phase 0.5 security fixes applied".

- [x] `scorecard_responses` — dropped `public_update_scorecard` policy
- [x] `vault_files` — dropped `anon_read_by_token` policy (share links → use Storage signed URLs if needed)
- [x] `agent_conversations` — RLS enabled
- [x] `agent_scratchpad` — RLS enabled

**Follow-ups out of scope for Phase 0.5** (see Q10 in open-questions):
- RLS disabled on 7 competitive-intelligence tables
- 3 functions with mutable `search_path`
- Public storage bucket `media` allows listing
- Auth leaked-password-protection disabled

## Phase 1 — Delete dead weight (no migration needed)

From the flags audit. These tools have broken paths or no real implementation.

| Tool | Why | Action |
|------|-----|--------|
| `mcp_server.py` (the file) | Deprecated monolith; all 49 tools re-registered. Superseded by split servers. | Delete file |
| `notion_sync` | Returns hardcoded mock data; never calls Notion API | Delete tool + registration |
| `publish_to_beehiiv` | `tools/beehiiv.py` file is missing entirely; runtime ImportError | Delete registration (or restore if still wanted) |
| `consolidate_memory` | Filters on `ingest_date` metadata that doesn't exist in Pinecone | Delete tool |
| `recalibrate_pinecone` | Reads `agent_retrieval_feedback` table; write path never wired | Delete tool |
| `get_retrieval_stats` | Same unwired feedback loop | Delete tool |
| `record_decision` / `record_learning` | Write to `channel="decisions"`/`"learnings"` in persona namespaces with no matching read path | Delete both |
| `save_data` / `query_data` | Generic KV scratch store with no curated content or dependents | Delete (use Supabase MCP directly if ever needed) |
| `file_reader` / `file_writer` | Railway sandbox pattern; Claude Code has native Read/Write/Edit | Delete |
| `system_heartbeat` | Monitored Railway; no Railway after cutover | Delete |

**Also:** 4 orphaned ingest scripts (`ingest_books.py`, `ingest_guides.py`, `ingest_reports.py`, `epub_ingest.py`) — not registered as MCP tools but referenced content may live in Pinecone `knowledge`. Move to `/ops/scripts/` and run manually if needed.

## Phase 2 — Collapse to native MCP (read paths)

### Pinecone MCP replacements
Collapses 4 tools → 1 parameterized pattern.

| GravityClaw tool | Replacement |
|---|---|
| `search_memory` | Pinecone MCP `search-records` (namespaces: `conversations` + `knowledge`) |
| `ask_priestley` | `search-records` with filter `channel_name in [...]` |
| `ask_hormozi` | `search-records` with filter `channel_name` + `author` |
| `ask_channel` | `search-records` with filter `channel_name = X` |

**Caveat:** Pinecone MCP data-plane tools work only on **integrated** indexes. Current `gravity-claw` index is bring-your-own (3072-dim OpenAI). See `03-decisions/open-questions.md` Q2. Three paths: (a) migrate to integrated, (b) call via SDK from Edge Function, (c) consolidate to pgvector. Decision pending.

**Also during this phase:** Drop `ask_priestley`'s hardcoded 14-channel allowlist. Move to a metadata tag or a config file.

### Supabase MCP replacements (table CRUD)

| Tool | Replacement |
|---|---|
| `get_core_facts` / `save_core_fact` / `forget_core_fact` | Supabase MCP on `agent_core_memory` |
| `get_recent_activity` | Supabase MCP on `agent_activity_log` (also: add missing index on `created_at`, `type`) |
| `get_recent_messages` | Supabase MCP on `agent_messages` (also: add missing index on `created_at`) |
| `search_signals` / `get_recent_signals` | Supabase MCP on `signals` (also: add missing indexes on `dismissed`, `saved`, `scraped_at`) |
| `get_youtube_videos` | Supabase MCP on `agent_youtube_videos` (also: add missing indexes on `channel_id`, `is_owned`, `published_at`) |

### Notion MCP replacements

| Tool | Replacement |
|---|---|
| `get_notion_tasks` | Notion MCP `notion-query-database-view` or `notion-search` (preserve the hardcoded database ID map as a reference doc) |
| `read_notion_database` | Notion MCP `notion-query-database-view` |
| `write_notion_page` | Notion MCP `notion-create-pages` |

### Firecrawl MCP replacement

| Tool | Replacement |
|---|---|
| `firecrawl_scrape` | Firecrawl MCP directly |

### Claude platform (scheduling)

| Tool | Replacement |
|---|---|
| `schedule_task` / `list_scheduled_tasks` / `cancel_scheduled_task` | Claude native scheduled tasks. The custom `scheduled_tasks` / `agent_scheduled_tasks` Supabase tables + Vercel cron can be decommissioned. |
| `daily_briefing` / `hygiene_report` | Claude scheduled task calling a Skill that reads Supabase MCP directly |

## Phase 1.75 — Memory layer design (blocks Phase 3)

Before writing Edge Functions, lock the memory layer interface. Design doc at [`05-design/memory-layer.md`](memory-layer.md) (drafted 2026-04-17); schema adjustments roll into Phase 5.

**Deliverables:**
- **Typed slots.** `facts` (`agent_core_memory`), `conversations` (`agent_messages` + `session_id`), `observations` (new table), `skill_versions` (new table), `reference_docs` (new table). One named interface, one write path per slot.
- **Frozen-snapshot pattern.** System-prompt assembly takes a per-session snapshot of the primary memory at session start. Mid-session writes land on live rows but do not touch the snapshot — preserves the prefix cache. Pattern lifted from Hermes `tools/memory_tool.py:105-140` (see `04-audit/2026-04-17-hermes-agent-review.md` §3.1).
- **Provider policy enforcement.** Primary = Supabase MCP on the tables above (always on). One plugin slot = the single vector backend (Q2 resolves which). No second plugin without an explicit decisions-log entry.
- **Injection guardrail.** Before persistence, scan incoming content with the threat-pattern list ported from Hermes `tools/memory_tool.py:65-102` — prompt-injection strings, invisible Unicode (zero-width / bidi overrides), exfiltration primitives. Applies especially to URL-scraped captures via Firecrawl.

**Blocks:** Phase 3 `capture()` Edge Function writes against this interface. Getting it wrong here means rewriting Phase 3.

**Non-blocks:** Phase 1, Phase 2, and the dashboard Supabase migration all proceed independently.

## Phase 3 — Edge Functions (write paths + unique logic)

Supabase has **zero Edge Functions deployed** today. All of these will be net-new.

### Priority (migrate first)

| Function | Why priority | Notes |
|---|---|---|
| `capture_thought` | Core memory pattern, used heavily | Dual-write: Supabase log + Pinecone (or pgvector if consolidating) |
| `ingest_youtube_video` + `preview_youtube_ingest` + `youtube_sync` | Non-trivial: transcript + chunking + embed + upsert | Port from `tools/youtube_ingest.py` |
| `ingest_signals` | RSS + Gemini summarization + scoring + dual write | Fix the **missing `signals` Pinecone namespace** bug (high-relevance signals are silently dropped) |

### Keep as Edge Functions (unique logic)

- `sync_youtube_comments` (Gemini sentiment analysis)
- `publish_instagram_post` / `publish_instagram_carousel` (3-step Graph API flow; behind approval gate)
- `generate_voice` (ElevenLabs wrapper)
- `generate_pdf` / `generate_invoice` (PDF generation)
- `publish_to_vault` (Supabase Storage + metadata upsert)
- `update_factory_session` (factory session log; also expose a read path)

### Supabase capabilities worth using
From the audit, three extensions are **available but not installed** — worth enabling:

| Extension | Use case |
|---|---|
| `vector` (pgvector 0.8.0) | If Q2 resolves toward consolidation |
| `pg_cron` (1.6.4) | Could replace Vercel cron for data-layer scheduled jobs |
| `pg_net` (0.19.5) | Async HTTP from inside the DB (webhooks, edge-function triggers) |

## Phase 4 — Claude Skills (Tier 4 rewrites)

Convert remaining custom tools to portable Skills that wrap native MCP calls.

| Tool | Skill form |
|---|---|
| `run_meeting` | Skill reads `.agent/skills/meeting/SKILL.md`; Notion writes via Notion MCP |
| `suggest_skill` | Skill reads recent `agent_activity_log` via Supabase MCP, drafts SKILL.md |
| `ask_priestley` / `ask_hormozi` / `ask_channel` | Skills wrapping Pinecone MCP with appropriate filters |
| `suggest_handoff` | **Drop** — the persona/routing system is retired in the rebuild |

## Phase 5 — Schema cleanup (during rewire, not after)

Do this while migrating — fresh Edge Functions write against the cleaned-up schema, so you only port once.

### Inconsistencies to fix
- [ ] Standardize on `gen_random_uuid()` (pgcrypto). Drop `uuid-ossp` dependency. Affects: `clients`, `invoices`, `invoice_items`, `rhythm_plans`, `rhythm_activities`.
- [ ] `agent_messages.id` — migrate from `bigint` sequence to `uuid` for consistency. Add a `session_id` column to group messages by thread.
- [ ] `rhythm_plans.user_id` — decide: `uuid` with FK, or document why it's `text` (external ID like Clerk).
- [ ] `research` — consolidate `research_status` + `status` into one column.
- [ ] `scheduled_tasks` — drop after migrating the 7 remaining rows (superseded by `agent_scheduled_tasks`, or by Claude native).
- [ ] `dc_config`, `agent_data_store` — consolidate redundant RLS policies.
- [ ] `dc_episodes` — add unique constraint on `(season, episode_number)`.
- [ ] `agent_habits` — 0 rows. Drop unless actively planned.

### Missing indexes (high-traffic)
- [ ] `agent_activity_log` — add `created_at DESC`, `type`
- [ ] `agent_cost_log` — add `created_at DESC`, `service`
- [ ] `agent_youtube_videos` — add `channel_id`, `is_owned`, `published_at DESC`
- [ ] `signals` — add `dismissed`, `saved`, `scraped_at DESC`
- [ ] `posts` / `projects` / `research` — add `status`, `published_at DESC`
- [ ] `rhythm_activities` — add `plan_id`
- [ ] `suggested_activities` — add `area`, `cadence`

## Phase 6 — Cutover & decommission

- [ ] Verify all surfaces (web / iPhone / desktop / Code) work without GravityClaw MCP
- [ ] Delete deprecated `mcp_server.py`; ensure Railway is pointing at the split servers (or nothing)
- [ ] 1-week observation window
- [ ] Decommission Railway (or downgrade to archive-only)

---

## Blocking decisions

Before starting the rewire, resolve:

- **Q2 — Vector strategy** (`03-decisions/open-questions.md`): a/b/c/d path forward
- **Q8 — Supabase project split** (new): keep agent + CMS + ZPM in one project, or split?

Everything else can proceed piecewise without upfront decisions.
