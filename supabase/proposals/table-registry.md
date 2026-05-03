# Table Registry & Intent Router — Proposal

**Date:** 2026-04-26
**Status:** Proposal only — no DB changes yet.
**Scope:** All 63 base tables in `public` schema of `obizmgugsqirmnjpirnh` (em-edmund-mitchell).

The goal is twofold:

1. **`table_registry`** — a metadata table the agent (or an Edge Function it calls) can read to know *what each table is for*, *whether it's safe to query by default*, and *when not to query it*. This becomes the ground truth that prevents us from leaking legacy / scratch / commerce-PII tables into general retrieval.
2. **`intent_router`** — a mapping from coarse user-intent labels to (a) the canonical table(s) to query, (b) the search style (vector / SQL / hybrid), (c) any required filters (e.g. `canonical = true`, `archived = false`).

Together: the agent classifies the user's question into an intent → looks up the routed tables → reads the registry to confirm those tables are safe + canonical for that intent → runs the query.

---

## Part 1 — Proposed `table_registry` schema

```sql
create table public.table_registry (
  table_name        text primary key,
  domain            text not null,        -- see vocabulary below
  layer             text not null,        -- raw|summary|observation|pattern|atlas|log|metric|task|artifact|config|intake|commerce|unknown
  purpose           text not null,        -- 1-line human description
  canonical_status  text not null,        -- canonical|supporting|legacy|scratch|unknown
  safe_for_default_retrieval boolean not null default false,
  query_style       text,                 -- vector|sql|hybrid|none
  retrieval_notes   text,                 -- when to query / when NOT to query
  owner_intent      text[],               -- which intent_router intents this table backs
  row_count_approx  bigint,
  last_audited_at   timestamptz default now()
);
```

**Domain vocabulary (proposed):** `memory`, `knowledge`, `content`, `signals`, `agents`, `sessions`, `tasks`, `dashboard`, `commerce`, `marketing-site`, `clients`, `assessments`, `dc` (Digital Continent), `ingest`, `lab`.

---

## Part 2 — Classification of every existing table

Format: **table** — domain · layer · canonical_status · safe_default? · purpose / notes.

### Memory & knowledge layer (canonical retrieval surfaces)

| Table | Domain | Layer | Canonical | Safe default? | Notes |
|---|---|---|---|---|---|
| `memory` (~14k rows) | memory | raw | **canonical** | ✅ | Single-table pgvector store. The default semantic-search target for `memory_lookup`. Filter by `namespace` to scope. |
| `reference_docs` (169 rows) | knowledge | atlas | **canonical** | ✅ | One row per slug; goals, KPIs, frameworks, CLAUDE-style docs. Filter `status = 'active'`. Primary target for `concept_lookup`. |
| `reference_docs_kinds` | knowledge | config | supporting | ❌ | Vocabulary table only — query for validation, not for content. |
| `skill_versions` | knowledge | atlas | **canonical** | ✅ (latest version only) | SOPs-as-skills. Always filter `status='active'` and `version = max(version) per skill_name`. Target for `workflow_planning`. |
| `observations` (4 rows) | knowledge | observation | **canonical** | ⚠️ approved-only | Agent-flagged candidate SOPs/preferences. Default queries should require `approved_at IS NOT NULL` OR `ready_for_promotion = true`. |
| `topics` / `content_topics` | knowledge | atlas | supporting | ❌ | Topic taxonomy + join table. Use only as filter/JOIN, not as primary search target. |

### Sessions, work, and audit trail

| Table | Domain | Layer | Canonical | Safe default? | Notes |
|---|---|---|---|---|---|
| `sessions` (23 rows) | sessions | log | **canonical** | ✅ | One row per Claude conversation/agent run. Parent of messages/work_log/observations. Use for `recent_activity`. |
| `work_log` (74 rows) | sessions | summary | **canonical** | ✅ | Agent-written "what got pushed forward." Best surface for `recent_activity` and `project_status` (last-touched per project). |
| `agent_messages` (354 rows) | sessions | raw | supporting | ❌ | Verbose conversation transcripts. Don't surface in default retrieval — only when explicitly debugging a session. |
| `agent_conversations` (17 rows) | sessions | raw | legacy? | ❌ | Older persona-conversation table; overlaps with `sessions` + `agent_messages`. Flag for consolidation. |
| `agent_activity_log` (2,618 rows) | agents | log | supporting | ❌ | Per-action activity stream. Useful for `agent_debugging` only. |
| `agent_run_logs` | agents | log | supporting | ❌ | Token/cost/tool-call detail per run. `agent_debugging` only. |
| `agent_cost_log` (486 rows) | agents | metric | supporting | ❌ | Cost rollup. Internal observability — not retrieval. |
| `factory_sessions` (91 rows) | sessions | log | **canonical** | ✅ | Sprint/branch-scoped session registry for the factory dashboard. `project_status`. |
| `factory_events` (163 rows) | sessions | log | supporting | ❌ | Event stream within a factory_session. `agent_debugging` / replay. |

### Workstreams, tasks, scheduling

| Table | Domain | Layer | Canonical | Safe default? | Notes |
|---|---|---|---|---|---|
| `workstreams` | tasks | atlas | **canonical** | ✅ | The canonical project/workstream registry. FK target. Use for `project_status`. |
| `projects` (3 rows) | marketing-site | artifact | supporting | ❌ | **NAME COLLISION.** This is the *portfolio* table for the public marketing site, not a project registry. Rename candidate (`portfolio_projects`). Don't use for `project_status`. |
| `agent_tasks` | tasks | task | **canonical** | ✅ | Inter-agent task queue. `workflow_planning`, `project_status`. Filter by `status`. |
| `agent_scheduled_tasks` | tasks | task | **canonical** | ✅ | Cron-style scheduled actions. Surface for `workflow_planning`. |
| `agent_wake_queue` | agents | task | supporting | ❌ | Internal wake-queue plumbing. `agent_debugging` only. |
| `workspace_items` | tasks | task | supporting | ❌ | Older task/spec object — overlaps with `agent_tasks`. Flag for consolidation. Possibly legacy. |

### Content / publishing

| Table | Domain | Layer | Canonical | Safe default? | Notes |
|---|---|---|---|---|---|
| `agent_youtube_videos` (379) | content | raw+summary | **canonical** | ✅ | Per-video metadata + transcript + summary. Owned-channel detection via `is_owned`. Primary for `content_idea_lookup` (own catalog) and `content_performance`. |
| `agent_youtube_comments` (101) | content | raw | supporting | ❌ | Comment data — supplementary signal, not retrieval target. |
| `content_metrics` (3,519) | content | metric | **canonical** | ✅ | Time-series snapshots across platforms. Primary for `content_performance` (trend queries). |
| `beehiiv_post_metrics` | content | metric | **canonical** | ✅ | Newsletter performance. `content_performance` for newsletters. |
| `content_items` (204) | content | raw | supporting | ❌ | Competitor-scraped content. Only relevant to `business_lookup` / competitive research, not own content. |
| `competitors` | content | atlas | supporting | ❌ | Competitor registry. Filter target only. |
| `signals` (83) | signals | summary | **canonical** | ✅ | Curated trend signals (saved/dismissed). `research_question` and `content_idea_lookup` (external). Filter `dismissed = false`. |
| `signal_source_health` | signals | metric | supporting | ❌ | Source-health observability. `agent_debugging`. |
| `scrape_runs` | signals | log | supporting | ❌ | Scraper run log. `ingestion_status`. |
| `ai_analyses` (364) | content | observation | supporting | ⚠️ | LLM analyses keyed to content_items/competitors. Useful for `business_lookup`; not for general retrieval. |

### Marketing site / public assets (NOT for default retrieval)

| Table | Domain | Layer | Canonical | Safe default? | Notes |
|---|---|---|---|---|---|
| `posts` (6) | marketing-site | artifact | supporting | ❌ | Public blog posts. Only for `business_lookup` when explicitly asked about EM site content. |
| `projects` (3) | marketing-site | artifact | supporting | ❌ | Public portfolio (see name-collision note). |
| `research` (4) | marketing-site | artifact | supporting | ❌ | Public research-page content. Don't confuse with `research_question` retrieval — this is published artifacts. |
| `products` | commerce | artifact | supporting | ❌ | Storefront catalog. `business_lookup` only. |
| `services` | commerce | artifact | supporting | ❌ | Service catalog. `business_lookup` only. |
| `lead_magnets` | marketing-site | artifact | supporting | ❌ | Lead-magnet catalog. |

### Intake / submissions / commerce (PII — NEVER default retrieval)

| Table | Domain | Layer | Canonical | Safe default? | Notes |
|---|---|---|---|---|---|
| `contact_submissions` | intake | intake | supporting | ❌ | Contact form leads. PII. Explicit-intent only. |
| `lead_magnet_submissions` | intake | intake | supporting | ❌ | Lead-magnet submissions. PII. |
| `waitlist` | intake | intake | supporting | ❌ | PII. |
| `scorecard_responses` | assessments | intake | supporting | ❌ | 14-question scorecard responses. PII. |
| `assessment_results` | assessments | summary | supporting | ❌ | ZPM assessment scores. PII per `user_id`. |
| `clients` | clients | atlas | supporting | ❌ | Client roster. PII. |
| `invoices`, `invoice_items` | commerce | log | supporting | ❌ | Financial. Never general retrieval. |
| `profiles` | clients | atlas | supporting | ❌ | User profiles. PII. |

### Digital Continent (DC podcast / show)

| Table | Domain | Layer | Canonical | Safe default? | Notes |
|---|---|---|---|---|---|
| `dc_episodes` | dc | atlas | **canonical** (DC scope) | ✅ for DC intents | Episode registry. |
| `dc_ideas` (5) | dc | summary | **canonical** (DC scope) | ✅ for DC intents | Episode idea bank. `content_idea_lookup` when DC-scoped. |
| `dc_youtube_assets` | dc | artifact | supporting | ❌ | Per-episode YT metadata. |
| `dc_config` | dc | config | supporting | ❌ | Config only. |

### Rhythm / coaching

| Table | Domain | Layer | Canonical | Safe default? | Notes |
|---|---|---|---|---|---|
| `rhythm_plans` | clients | atlas | supporting | ❌ | Per-user rhythm plan. PII. |
| `rhythm_activities` (35) | clients | task | supporting | ❌ | Activities within a plan. PII. |
| `suggested_activities` | clients | atlas | supporting | ❌ | Static suggestion library. Could become canonical for a `rhythm_lookup` intent — not in scope today. |

### Ingest / observability

| Table | Domain | Layer | Canonical | Safe default? | Notes |
|---|---|---|---|---|---|
| `ingest_runs` | ingest | log | **canonical** | ✅ for `ingestion_status` only | Single source of ingest health. Not for general retrieval. |
| `memory_dualread_log` | ingest | log | legacy (cutover artifact) | ❌ | Pinecone→pgvector parity log. Will retire post-cutover. |
| `agent_retrieval_feedback` (0) | memory | observation | scratch | ❌ | Empty. Future thumbs-up/down log; ignore for now. |
| `vault_files` | artifacts | artifact | supporting | ❌ | File storage registry. `business_lookup` when asked about a specific file. |

### Agents — registry & legacy memory (MUDDY ZONE — flag for cleanup)

| Table | Domain | Layer | Canonical | Safe default? | Notes |
|---|---|---|---|---|---|
| `agents` (13) | agents | atlas | **canonical** | ✅ | Agent persona registry (identity_md, claude_md, soul_md). Filter `archived = false`. |
| `agent_core_memory` (343) | agents | atlas | **legacy** | ❌ | Key/value persona memory. Likely overlaps with `reference_docs`. Audit + migrate. |
| `agent_memory` | agents | raw | **legacy** | ❌ | Older per-agent memory. Pre-`memory` table. |
| `agent_data_store` (13) | agents | config | supporting | ❌ | Generic key/value store. Probably config — name suggests scratch. |
| `agent_scratchpad` | agents | scratch | **scratch** | ❌ | Explicit scratchpad. Never default retrieval. |
| `slack_messages` | agents | raw | supporting | ❌ | Slack archive. `agent_debugging` / explicit-intent only. |

---

## Part 3 — Proposed `intent_router`

```sql
create table public.intent_router (
  intent           text primary key,
  description      text not null,
  primary_tables   text[] not null,        -- canonical, query first
  secondary_tables text[],                 -- enrichment / fallback
  forbidden_tables text[],                 -- NEVER include for this intent (PII / off-topic)
  query_style      text not null,          -- vector|sql|hybrid
  required_filters jsonb,                  -- e.g. {"reference_docs":{"status":"active"}}
  default_limit    int default 10,
  notes            text
);
```

### Intent rows (proposed)

| Intent | Primary tables | Secondary | Style | Required filters / notes |
|---|---|---|---|---|
| `recent_activity` | `work_log`, `sessions` | `factory_sessions`, `factory_events`, `agent_tasks` | sql | Order by `created_at desc`. Optional `project` filter. |
| `project_status` | `workstreams`, `agent_tasks`, `work_log` | `factory_sessions` | hybrid | Join on `project_slug` / `workstreams.slug`. Filter `agent_tasks.status` ≠ `done`. NOT `public.projects`. |
| `concept_lookup` | `reference_docs` | `skill_versions`, `memory` | hybrid | `reference_docs.status='active'`; vector-search body, exact-match slug. |
| `memory_lookup` | `memory` | `reference_docs` | vector | Optional `namespace` filter; default top_k=10. |
| `research_question` | `memory`, `signals` | `reference_docs`, `ai_analyses` | hybrid | `signals.dismissed=false`; vector over `memory` with `namespace IN ('research','articles','youtube')`. |
| `content_idea_lookup` | `dc_ideas`, `signals`, `agent_youtube_videos` | `memory` (transcripts) | hybrid | Scope hint: DC vs EM personal vs Cordial Catholics — choose by `is_owned` / `channel_id` / `season`. |
| `content_performance` | `content_metrics`, `agent_youtube_videos`, `beehiiv_post_metrics` | — | sql | Time-series — needs `fetched_at` window. |
| `business_lookup` | `posts`, `services`, `products`, `lead_magnets`, `competitors`, `clients` | `vault_files`, `ai_analyses` | sql | Explicit-intent gate. PII tables (clients, profiles, *_submissions, invoices) require an additional `pii_ok=true` flag from the caller. |
| `ingestion_status` | `ingest_runs` | `scrape_runs`, `signal_source_health` | sql | Order by `started_at desc`. |
| `agent_debugging` | `agent_run_logs`, `agent_activity_log`, `factory_events` | `agent_messages`, `agent_wake_queue`, `slack_messages`, `memory_dualread_log` | sql | Always require an explicit `session_id` or time window. |
| `workflow_planning` | `skill_versions`, `agent_scheduled_tasks`, `agent_tasks` | `workstreams`, `reference_docs` | hybrid | `skill_versions.status='active'` and latest-version-only. |

### Forbidden-by-default (cross-cutting)

For *all* intents except `business_lookup` (with explicit PII flag) and `agent_debugging` (with explicit session scope):

```
forbidden_default := [
  'clients','profiles','contact_submissions','lead_magnet_submissions',
  'waitlist','scorecard_responses','assessment_results','rhythm_plans',
  'rhythm_activities','invoices','invoice_items',
  'agent_scratchpad','agent_memory','agent_core_memory','agent_data_store',
  'memory_dualread_log','agent_retrieval_feedback','agent_messages'
]
```

---

## Part 4 — Issues found & cleanup candidates (NOT acted on)

1. **`projects` vs `workstreams` naming collision.** `public.projects` is a marketing-site portfolio table; `workstreams` is the real project registry. Rename `projects` → `portfolio_projects`. (Comment on `workstreams` already documents this.)
2. **Three overlapping "agent memory" tables**: `agent_memory`, `agent_core_memory`, `agent_data_store`. With `memory` (pgvector) + `reference_docs` now canonical, these three are legacy — audit, migrate any live values, and retire.
3. **Sessions duplication:** `agent_conversations` overlaps with `sessions` + `agent_messages`. Decide which is canonical and migrate.
4. **`workspace_items` (16 cols) overlaps `agent_tasks` (19 cols)** — pick one.
5. **`memory_dualread_log`** is a cutover artifact; schedule retirement once Pinecone is gone.
6. **PII-bearing tables have no explicit RLS-enforced "agent default-deny" yet** — the registry's `safe_for_default_retrieval=false` should be backed by a policy, not just a convention.
7. **Most tables lack `COMMENT ON TABLE`.** Of 63, only ~10 have comments. Adding them as part of building the registry is cheap and big upside.
8. **Empty / near-empty tables** (`agent_retrieval_feedback`=0, `observations`=4, `dc_ideas`=5, `posts`=6, `projects`=3) — confirm whether each is "scratch unused" or "actively populated, just early".

---

## Part 5 — Suggested rollout (not executed)

1. Create `table_registry` and seed from this doc (one INSERT per table).
2. Create `intent_router` and seed the 11 intents above.
3. Add a thin Edge Function `route_query(intent, query, scope)` that:
   - looks up `intent_router.intent`,
   - reads `table_registry` to skip any non-`safe_for_default_retrieval` table unless explicitly allowed,
   - dispatches to the right query style (`vector` → `memory.match_documents`, `sql` → parameterized SELECTs, `hybrid` → both).
4. Refactor existing retrieval call sites to go through `route_query` instead of hard-coding tables.
5. Phase 2: enforce default-deny on PII tables via RLS, with a session-scoped `app.pii_ok` GUC for explicit-intent unlocks.

---

*Prepared in response to the 2026-04-26 design ask. No DDL or DML run; this is a read-only proposal.*
