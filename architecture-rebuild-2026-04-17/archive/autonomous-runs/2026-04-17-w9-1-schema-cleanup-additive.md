# Autonomous run — W9.1a schema cleanup (additive)

**Date:** 2026-04-17
**Status:** 🟢 Shipped
**Project:** Supabase `obizmgugsqirmnjpirnh`
**Migration version:** `20260417090000_schema_cleanup_additive.sql`
**Migration name (applied):** `schema_cleanup_additive_2026_04_17`

## What ran

- Phase 1 audit: queried `information_schema.tables`, `pg_indexes`, `information_schema.columns`, `pg_constraint`. Found 62 public tables, 11 missing DESC indexes on watched readers, 7 tables still on `uuid_generate_v4()` + one (`factory_sessions`) with no DEFAULT at all on its uuid PK. Orphan candidates: `scheduled_tasks`, `agent_habits` (both confirmed zero inbound FKs).
- Phase 2 migration write: 11 `CREATE INDEX IF NOT EXISTS` + 8 `ALTER TABLE ... SET DEFAULT gen_random_uuid()` = 19 statements. Idempotent.
- Phase 3 apply: `apply_migration` returned `{"success":true}`.
- Phase 4 verification:
  - All 11 expected indexes present in `pg_indexes`.
  - All 8 targeted columns now default to `gen_random_uuid()`.
  - `SELECT COUNT(*) FROM information_schema.columns WHERE column_default LIKE '%uuid_generate_v4%' AND table_schema = 'public'` returns **0**.

## Changes applied

**New indexes (11):**
- `idx_agent_cost_log_created_at_desc`
- `idx_agent_youtube_videos_created_at_desc`
- `idx_agent_youtube_videos_published_at_desc`
- `idx_signals_published_at_desc`
- `idx_posts_created_at_desc`
- `idx_posts_published_at_desc`
- `idx_projects_created_at_desc`
- `idx_projects_published_at_desc`
- `idx_research_created_at_desc`
- `idx_research_published_at_desc`
- `idx_factory_sessions_created_at_desc`

**Default changes (8):**
- `assessment_results.id` — `uuid_generate_v4()` → `gen_random_uuid()`
- `clients.id` — `uuid_generate_v4()` → `gen_random_uuid()`
- `invoice_items.id` — `uuid_generate_v4()` → `gen_random_uuid()`
- `invoices.id` — `uuid_generate_v4()` → `gen_random_uuid()`
- `rhythm_activities.id` — `uuid_generate_v4()` → `gen_random_uuid()`
- `rhythm_plans.id` — `uuid_generate_v4()` → `gen_random_uuid()`
- `suggested_activities.id` — `uuid_generate_v4()` → `gen_random_uuid()`
- `factory_sessions.id` — `NULL` → `gen_random_uuid()` (previously had no default)

## Nothing destructive was run

No DROP, no TRUNCATE, no DELETE, no type changes, no RLS/policy changes. Per the autonomy charter, destructive operations require Edmund's explicit per-instance approval.

## Pending destructive follow-up (W9.1b — not applied)

1. `DROP TABLE public.scheduled_tasks` — 7 rows, zero inbound FKs. Superseded by `agent_scheduled_tasks`.
2. `DROP TABLE public.agent_habits` — 0 rows, zero inbound FKs. Never populated.
3. `DROP EXTENSION "uuid-ossp"` — post-this-run, zero public columns still use `uuid_generate_v4()`. Recommend verifying no non-public dependencies via `pg_depend` before drop.

See `05-design/plans/2026-04-17-w9-1-schema-cleanup.md` for detail.

## Artifacts

- Migration file: `dashboard/supabase/migrations/20260417090000_schema_cleanup_additive.sql`
- Plan doc: `architecture-rebuild-2026-04-17/05-design/plans/2026-04-17-w9-1-schema-cleanup.md`
- This run log: `architecture-rebuild-2026-04-17/06-handoffs/autonomous-runs/2026-04-17-w9-1-schema-cleanup-additive.md`

## Notable observations

- `signals` has no `created_at` column — only `published_at`. Indexed that instead.
- `factory_sessions.id` was `uuid` typed but had no DEFAULT. Any insert previously required explicit id. Now standard.
- `profiles.id` intentionally has no DEFAULT because it's FK'd to `auth.users.id`. Not modified.
- Several other tables have duplicate overlapping indexes (e.g., `agent_conversations` has both `agent_conversations_persona_id_idx` and `idx_agent_conversations_persona` on `(persona_id, updated_at DESC)`, plus a third variant). These are candidates for consolidation in a future cleanup pass — flagged, not in scope for W9.1.
