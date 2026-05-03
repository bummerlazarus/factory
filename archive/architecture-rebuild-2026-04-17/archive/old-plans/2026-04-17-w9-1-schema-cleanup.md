# W9.1 — Phase 5 schema cleanup

**Date:** 2026-04-17
**Status:**
- W9.1a (additive): 🟢 **Shipped** — see run log `2026-04-17-w9-1-schema-cleanup-additive.md`
- W9.1b (destructive): ⚪ **Pending Edmund approval**

**Project:** Supabase `obizmgugsqirmnjpirnh`

---

## Phase 1 — Audit findings

### Tables in `public` (62 total)

Full list available via `list_tables`. Row-count highlights:
- `memory`: 14,056 rows (pgvector store)
- `agent_activity_log`: 2,619
- `content_topics`: 655
- `agent_cost_log`: 486
- `ai_analyses`: 450
- `agent_youtube_videos`: 362
- `agent_messages`: 354
- `agent_core_memory`: 336
- `content_items`: 209
- `factory_events`: 166
- `scheduled_tasks`: 7 rows (**candidate for drop — W9.1b**)
- `agent_habits`: 0 rows (**candidate for drop — W9.1b**)

### Missing `created_at DESC` / `published_at DESC` indexes (DESC readers)

| Table | Missing index |
|---|---|
| `agent_cost_log` | `created_at DESC` |
| `agent_youtube_videos` | `created_at DESC`, `published_at DESC` |
| `signals` | `published_at DESC` (no `created_at` column) |
| `posts` | `created_at DESC`, `published_at DESC` |
| `projects` | `created_at DESC`, `published_at DESC` |
| `research` | `created_at DESC`, `published_at DESC` |
| `factory_sessions` | `created_at DESC` |

Already covered (no action needed):
- `agent_activity_log` — has `agent_activity_log_created_at_idx (created_at DESC)`
- `memory` — has `idx_memory_created_at_desc`
- `work_log` — has `idx_work_log_created_at_desc`
- `observations` — has `idx_observations_created_at_desc`
- `content_metrics` — has `idx_content_metrics_fetched_at`
- `content_items` — has `content_items_published_idx`
- `agent_messages` — has composite `idx_agent_messages_session_created`
- `sessions` — has `idx_sessions_started_at_desc`
- `factory_events` — has `idx_factory_events_created`
- `agent_conversations` — has `agent_conversations_updated_at_idx`

### UUID defaults using `uuid_generate_v4()` (non-standard)

| Table | PK col | Old default | Target |
|---|---|---|---|
| `assessment_results` | `id` | `uuid_generate_v4()` | `gen_random_uuid()` |
| `clients` | `id` | `uuid_generate_v4()` | `gen_random_uuid()` |
| `invoice_items` | `id` | `uuid_generate_v4()` | `gen_random_uuid()` |
| `invoices` | `id` | `uuid_generate_v4()` | `gen_random_uuid()` |
| `rhythm_activities` | `id` | `uuid_generate_v4()` | `gen_random_uuid()` |
| `rhythm_plans` | `id` | `uuid_generate_v4()` | `gen_random_uuid()` |
| `suggested_activities` | `id` | `uuid_generate_v4()` | `gen_random_uuid()` |
| `factory_sessions` | `id` | **NULL** (no default) | `gen_random_uuid()` |

All target columns already `uuid` type — only DEFAULT changed, no type change.

Not modified (already correct):
- `profiles.id` — PK uuid, NULL default (FK to `auth.users.id`, intentionally has no default)

### Orphan-candidate tables (no inbound FKs)

Checked via `pg_constraint` — zero foreign keys point to either:
- `public.scheduled_tasks` (7 rows) — superseded by `agent_scheduled_tasks`
- `public.agent_habits` (0 rows) — never populated

Both safe to drop from an FK perspective. Holding for Edmund confirmation.

### Extensions

- `uuid-ossp` — installed in `extensions` schema. **After this additive migration, no remaining columns in `public` use `uuid_generate_v4()` as DEFAULT** (verified: SELECT COUNT(*) = 0). The extension can be dropped in W9.1b if nothing else in the database (functions, non-public schemas) depends on it.
- `pgcrypto` — installed, provides `gen_random_uuid()`. Keep.

---

## Phase 2 — SQL applied (W9.1a)

Full migration file: `dashboard/supabase/migrations/20260417090000_schema_cleanup_additive.sql`

```sql
-- 11 CREATE INDEX IF NOT EXISTS statements (all DESC btree)
CREATE INDEX IF NOT EXISTS idx_agent_cost_log_created_at_desc ON public.agent_cost_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_youtube_videos_created_at_desc ON public.agent_youtube_videos (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_youtube_videos_published_at_desc ON public.agent_youtube_videos (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_published_at_desc ON public.signals (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created_at_desc ON public.posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_published_at_desc ON public.posts (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_created_at_desc ON public.projects (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_published_at_desc ON public.projects (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_created_at_desc ON public.research (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_published_at_desc ON public.research (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_factory_sessions_created_at_desc ON public.factory_sessions (created_at DESC);

-- 8 ALTER TABLE ... SET DEFAULT gen_random_uuid()
ALTER TABLE public.assessment_results   ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.clients              ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.invoice_items        ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.invoices             ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.rhythm_activities    ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.rhythm_plans         ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.suggested_activities ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.factory_sessions     ALTER COLUMN id SET DEFAULT gen_random_uuid();
```

**Total: 19 statements** (well under the 50-statement cap).

Applied via `apply_migration` with name `schema_cleanup_additive_2026_04_17`. Result: `{"success":true}`.

---

## Phase 4 — Post-apply verification

All 11 new indexes present in `pg_indexes`. All 8 target columns now have `gen_random_uuid()` DEFAULT. `SELECT COUNT(*)` of remaining `uuid_generate_v4()` defaults in `public` = **0**.

---

## Pending destructive follow-up (W9.1b — needs Edmund approval)

Each line is a separate proposed DROP. Do NOT execute without explicit confirmation.

1. `DROP TABLE IF EXISTS public.scheduled_tasks;`
   - 7 rows, zero inbound FKs. Legacy from GravityClaw era; replaced by `agent_scheduled_tasks` (0 rows currently but canonical going forward).
   - Action item for Edmund: confirm no external MCP still writes here before drop.

2. `DROP TABLE IF EXISTS public.agent_habits;`
   - 0 rows, zero inbound FKs. Never populated.

3. `DROP EXTENSION IF EXISTS "uuid-ossp";`
   - Safe only after step 1–2 and after confirming no non-public-schema dependency. Verified zero `public` columns default to `uuid_generate_v4()` as of 2026-04-17 post-W9.1a.
   - Recommend running `SELECT pg_describe_object(classid, objid, 0) FROM pg_depend WHERE refobjid = (SELECT oid FROM pg_extension WHERE extname = 'uuid-ossp');` before the drop to confirm no unknown dependents.

4. Optional: investigate whether any of these low-row/possibly-unused tables are also candidates (NOT in scope for W9.1b unless Edmund says so):
   - `agent_memory` (1 row) vs `agent_core_memory` (336 rows) — possible duplication.
   - `agent_scratchpad` (1 row) — may be dev-only.
   - `workspace_items` (0 rows) — unclear usage.
   - `contact_submissions`, `waitlist`, `clients`, `invoices`, `invoice_items`, `scorecard_responses`, `lead_magnet_submissions` — all 0 rows but these are public-site inboxes, keep.

---

## Backlog status

- **W9.1a** 🟢 — additive schema cleanup (this run, shipped)
- **W9.1b** ⚪ — destructive: drop orphan tables + `uuid-ossp` extension (pending Edmund approval)
