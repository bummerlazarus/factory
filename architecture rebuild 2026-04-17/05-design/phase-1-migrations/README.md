# Phase 1 migrations — rich data capture

**Status:** DRAFT. Not yet applied to Supabase project `obizmgugsqirmnjpirnh`. Review SQL directly before applying.

**Why this phase:** Vision pillar 1 — "rich data capture first." Today's schema has no session grouping, no work log, no observations/promotions, no skill version history, no canonical reference docs. Those five tables are the minimum required to unlock pillars 2 (one source of truth), 3 (SOPs as Skills), 4 (self-improving loops), and 5 (proactive surfacing). See `../../01-context/vision-and-priorities.md` and `../../01-context/workflows-and-capture.md`.

## Apply order

The filenames are numbered `005`–`010`, but **numeric order is not the apply order** because `observations` (007) has an FK to `skill_versions` (008). Apply in this sequence:

| # | File | Why this position |
|---|---|---|
| 1 | `005_create_sessions.sql` | No FKs. Parent for 006, 007, 010. |
| 2 | `006_create_work_log.sql` | FK → sessions. |
| 3 | `008_create_skill_versions.sql` | **Apply before 007** — 007 references it. |
| 4 | `007_create_observations.sql` | FK → sessions, FK → skill_versions. |
| 5 | `009_create_reference_docs.sql` | No FKs. Independent. |
| 6 | `010_alter_agent_messages_add_session_id.sql` | FK → sessions. |

If you prefer numeric order, swap the numbers on 007 and 008 before applying. I left them as spec'd so the file list matches Edmund's prompt verbatim.

## What each migration does

### `005_create_sessions.sql`
Creates `sessions` — one Claude conversation / agent run across any surface (CEO Desk, Claude desktop/iPhone, Claude Code, Cowork, dashboard, Edge Function, MCP, scheduled task).
- Columns: `id`, `started_at`, `ended_at`, `source` (enum-check), `app` (free-text project tag), `title`, `summary`, `token_usage jsonb`, `metadata jsonb`, `created_at`, `updated_at`.
- Indexes: `started_at DESC`, `source`, `app`, GIN on `metadata`.
- RLS enabled. `authenticated` SELECT; service_role bypass.

### `006_create_work_log.sql`
Creates `work_log` — agent-written "what got pushed forward" entries. Source for the daily recap + last-touched-per-project dashboard surfaces.
- Columns: `id`, `session_id` (FK, nullable), `project`, `kind` (enum-check: decision/shipped/published/research/draft/note/blocker_cleared/meeting/retro), `summary`, `artifacts jsonb`, `created_at`.
- Indexes: `session_id`, `project`, `kind`, `created_at DESC`, GIN on `artifacts`.
- RLS enabled.

### `008_create_skill_versions.sql`
Creates `skill_versions` — version history for SOPs-as-Skills. One row per version; unique `(skill_name, version)`.
- Columns: `id`, `skill_name`, `version` int, `body`, `changelog`, `created_by` (free-text: "edmund" | "agent:<session_id>" | "promotion:<observation_id>"), `metadata jsonb`, `created_at`.
- Indexes: `skill_name`, `created_at DESC`, `(skill_name, version DESC)`.
- RLS enabled.

### `007_create_observations.sql`
Creates `observations` — agent-flagged patterns / candidate SOPs / preferences awaiting approval. This is the self-improving-loop table.
- Columns: `id`, `session_id` (FK), `kind` (enum-check: pattern/preference/candidate_skill/candidate_doc_update/contradiction/framework/todo/risk), `body`, `confidence numeric(3,2)`, `approved_at`, `promoted_to_skill_id` (FK → skill_versions), `metadata jsonb`, `created_at`.
- Indexes: `session_id`, `kind`, `created_at DESC`, partial index on `created_at DESC WHERE approved_at IS NULL` (the pending-review queue — dashboard's primary query).
- RLS enabled. `authenticated` can SELECT and UPDATE (to approve).

### `009_create_reference_docs.sql`
Creates `reference_docs` — canonical goal/value/KPI/framework/CLAUDE.md-style docs. One row per slug.
- Columns: `id`, `slug` (unique), `title`, `body`, `kind` (enum-check: goal/value/kpi/framework/claude_md/principle/persona/playbook/doc), `version` int, `metadata jsonb`, `updated_at`, `created_at`.
- Trigger `trg_reference_docs_set_updated_at` keeps `updated_at` fresh on any UPDATE.
- Indexes: unique on `slug`, plus `kind`, `updated_at DESC`, GIN on `metadata`.
- RLS enabled.

### `010_alter_agent_messages_add_session_id.sql`
Adds `session_id uuid` (FK → sessions, ON DELETE SET NULL) to existing `agent_messages`. Adds index `(session_id, created_at DESC)`. NOT NULL is intentionally NOT enforced — 354 legacy rows have no session. A later Phase 5 migration can backfill a synthetic "legacy" session and flip the column to NOT NULL, alongside the separate bigint→uuid PK migration the audit flagged.

## How to roll back

Each SQL file has a `Rollback` block in its header comment. Summary:

```sql
-- In reverse dependency order:
DROP INDEX IF EXISTS public.idx_agent_messages_session_created;
ALTER TABLE public.agent_messages DROP CONSTRAINT IF EXISTS agent_messages_session_id_fkey;
ALTER TABLE public.agent_messages DROP COLUMN IF EXISTS session_id;

DROP TABLE IF EXISTS public.reference_docs CASCADE;
DROP FUNCTION IF EXISTS public.reference_docs_set_updated_at();
DROP TABLE IF EXISTS public.observations CASCADE;
DROP TABLE IF EXISTS public.skill_versions CASCADE;
DROP TABLE IF EXISTS public.work_log CASCADE;
DROP TABLE IF EXISTS public.sessions CASCADE;
```

`CASCADE` is used because the tables reference each other; on a dev branch this is fine. On prod, prefer dropping FKs individually first.

## Conventions applied (from `../data-model.md`)

- `snake_case` everything.
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — no `uuid_generate_v4()`.
- `created_at timestamptz NOT NULL DEFAULT now()` on every table; `updated_at` on mutable rows.
- RLS enabled on every new table (Phase 0.5 lesson). Default policy = `authenticated` SELECT; service_role bypasses; anon denied.
- Indexes on FK columns + common filter columns + `created_at DESC` where applicable.
- Partial index on `observations WHERE approved_at IS NULL` (matches the `agent_scheduled_tasks` pattern in the audit).
- GIN indexes on JSONB columns we'll actually filter by (`metadata`, `artifacts`).

## Deviations from the spec

A few small additions beyond the exact fields Edmund listed, each with rationale:

1. **`sessions.updated_at`** — not in the spec but needed for "session still open; token_usage updated" writes. The retro flow will update the row after it's created.
2. **`sessions.source` enum-checked; `sessions.app` free-text.** The spec said "source/app". I split them: `source` is a closed set (which Claude surface) because we want clean reports; `app`/project tag is free-text because Claude projects churn constantly. Happy to merge back to one column if you'd rather.
3. **`work_log.kind`** — spec said `type`; I used `kind` to match `observations.kind` and avoid the reserved-word feel of `type`. Rename if you want.
4. **`observations.metadata jsonb`** — not in the spec, but observations will need to carry source message ids / related doc slugs for the promotion UI. Default `'{}'::jsonb` so it's free to ignore.
5. **`skill_versions.metadata jsonb`** — same reasoning: carries source-observation ids for "why was this version created?".
6. **`reference_docs` trigger on `updated_at`** — one tiny plpgsql trigger. Spec said `updated_at`; this just keeps it honest without app-side discipline. Everywhere else I relied on `created_at` defaults and `updated_at` being app-managed, but reference_docs is the canonical "which version is current" table — worth the seatbelt.
7. **Partial index `idx_observations_pending`** — not asked for, but the dashboard's triage queue will be `WHERE approved_at IS NULL ORDER BY created_at DESC`; a partial index pays for itself.

## Open questions

1. **`observations.kind` coverage.** I went with `pattern / preference / candidate_skill / candidate_doc_update / contradiction / framework / todo / risk`. Missing any? Specifically: should `metric` (a KPI observation) be separate, or does it live under `candidate_doc_update` targeting a `kind = 'kpi'` reference_doc?
2. **`work_log.kind`.** Went with `decision / shipped / published / research / draft / note / blocker_cleared / meeting / retro`. Is `decision` distinct enough from the `03-decisions/decisions-log.md` markdown flow, or should work_log avoid `decision` and leave that to the markdown log?
3. **`reference_docs` history.** v1 stores one row per slug with a `version` counter. If we want full history (diff view, rollback), add `reference_doc_versions` later — same shape as `skill_versions`. Flag if you want that now.
4. **`sessions` user scoping.** All policies use `authenticated USING (true)` because Edmund is the only user. If ZPM / Real+True or a client ever writes here, we need `user_id uuid REFERENCES auth.users` and tighter policies. Not in scope for v1; called out so it doesn't surprise us later.
5. **`agent_messages` bigint → uuid.** The audit (#5) flagged this separately. Migration 010 intentionally leaves the PK alone and only adds `session_id`. Separate Phase 5 migration will address the PK; doing both in one migration risks a painful rollback.
6. **Token rollup cadence.** `sessions.token_usage` is a rollup, but `agent_cost_log` already captures per-call costs. Do we (a) trigger on `agent_cost_log` inserts to increment `sessions.token_usage`, (b) let the retro Edge Function recompute on session close, or (c) both? I'd lean (b) for simplicity — flagged for a call.
7. **Enum check vs Postgres ENUM type.** I used `CHECK` constraints rather than `CREATE TYPE ... AS ENUM`. Cheaper to add values (`ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...` vs `ALTER TYPE ... ADD VALUE`). Matches the pattern the existing schema uses for `agent_activity_log.type` and `agent_cost_log.service`. Flag if you want real ENUM types for any of these.

## What's NOT in this phase (deliberately)

- pgvector install + `memory` table (Q2 in open questions — still Pinecone for now).
- `agent_messages` PK migration (bigint → uuid).
- Backfilling legacy `agent_messages` into a synthetic session.
- `capture()` Edge Function (Phase 3).
- Any triage/retro Skills (Phase 3+).

Those all depend on this phase landing first.
