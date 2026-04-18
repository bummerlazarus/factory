# W7.2a+b — Workstreams table + FK refactor

**Date:** 2026-04-18
**Epics:** W7.2a (seed canonical workstreams + scope docs) and W7.2b (FK refactor on `work_log` + `agent_tasks`).
**Status:** 🟢 DONE — both epics shipped in one run.
**Project ref:** `obizmgugsqirmnjpirnh`.

## Naming collision — the `workstreams` story

The original plan called for a table named `public.projects`. When a prior subagent began the run, it discovered `public.projects` **already existed** in the database — a 3-row portfolio table with RLS policies enabled (two policies intended for public-web reads, likely powering edmund.dev's portfolio section). It correctly paused and flagged the collision.

Edmund's call (2026-04-18): **Option 2 — rename our canonical table to `public.workstreams`.** Fully additive, no rename of the existing table, no RLS rework, no risk to external readers. The FK columns on `work_log.project` and `agent_tasks.project_slug` keep their historical names and FK into `workstreams(slug)`. Mental model: a `work_log` entry belongs to a **workstream** (a.k.a. project).

Corresponding FK constraint names:
- `work_log_workstream_fk`
- `agent_tasks_workstream_fk`

The pre-existing `public.projects` (portfolio) table was NOT touched. Its RLS policies were NOT modified. No additional RLS was added to our new `workstreams` table — server-side dashboard reads use service-role (bypasses RLS), so leaving RLS OFF is safe until a public-web consumer needs it.

## Edmund's scope resolutions (2026-04-18)

Cited here because they shape the 6/9 seed counts:

1. **Lisa dropped** — sub-contact of Culture Project, not a separate client. `artifacts.client` enum tightens to 3: `cfcs`, `liv-harrison`, `culture-project`.
2. **`em-brand` absorbs `cordial-catholics`** — single workstream. Cordial Catholics content uses `artifacts.stream='cordial-catholics'`.
3. **IOC no project tag** — IOC system lives in `reference_docs` (slug `ioc-system-v2`, kind `framework`), not as a workstream.

## Migrations applied (in order)

1. **`20260418100000_client_scope_kind.sql`** — seed `'client-scope'` kind into `reference_docs_kinds`. Idempotent `INSERT ... ON CONFLICT DO NOTHING`.
2. **`20260418101000_workstreams_table.sql`** — `CREATE TABLE public.workstreams` (slug PK, kind CHECK in 4 values, status CHECK in 3 values, title/description, metadata JSONB, created_at/updated_at). Seeds 6 canonical rows.
3. **`20260418102000_workstreams_fk.sql`** — adds `work_log_workstream_fk` and `agent_tasks_workstream_fk` via `NOT VALID` + `VALIDATE` two-step, `ON DELETE SET NULL`. Both validated cleanly against existing data.

All three applied successfully via `mcp__...__apply_migration`.

## Seeded 6 workstreams (all `status='active'`)

| slug | kind | title |
|---|---|---|
| `factory` | internal-infra | Factory rebuild |
| `dc-clients` | dc-client-umbrella | Digital Continent clients |
| `zpm` | internal-venture | Zealous Parish Ministers |
| `real-true` | internal-venture | Real + True |
| `faith-ai` | internal-venture | Faith & AI Project |
| `em-brand` | personal-brand | EM personal brand (incl. Cordial Catholics stream) |

## Seeded 9 scope docs (`reference_docs.kind='client-scope'`)

Six for the workstreams plus three for DC sub-clients:

1. `scope-factory`
2. `scope-dc-clients`
3. `scope-zpm`
4. `scope-real-true`
5. `scope-faith-ai`
6. `scope-em-brand`
7. `scope-dc-clients-cfcs`
8. `scope-dc-clients-liv-harrison`
9. `scope-dc-clients-culture-project`

Each row carries body sections: `## Status`, `## Type`, `## Retainer`, `## Contact`, `## Deliverables`, `## Drift-risk`, `## Last touch`. Metadata JSONB includes `workstream_slug`, `type`, `needs_enrichment` (where applicable), and sub-client/stream metadata.

## Acceptance criteria — all green

| # | Check | Expected | Actual |
|---|---|---|---|
| 1 | `SELECT count(*) FROM public.workstreams WHERE status='active'` | 6 | **6** |
| 2 | `SELECT count(*) FROM reference_docs WHERE kind='client-scope'` | 9 | **9** |
| 3 | Bite: `INSERT work_log (project='not-a-real-slug', ...)` | FK violation on `work_log_workstream_fk` | **PASS** — `insert or update on table "work_log" violates foreign key constraint "work_log_workstream_fk"` |
| 4 | Bite: `INSERT work_log (project='cfcs', ...)` | FK violation (cfcs is a sub-client) | **PASS** — same FK violation message |
| 5 | Existing `work_log` rows with `project='factory'` still validate | 8 rows preserved | **8** (work_log_factory_still_valid=8; VALIDATE CONSTRAINT passed at migration time) |
| 6 | `agent_tasks_workstream_fk` installed + validates existing rows (1 row, `project_slug IS NULL`) | FK exists, convalidated=true, trivial pass | **PASS** — `pg_constraint.convalidated=true`; 1 row with NULL slug |

### Initial bite-test gotcha

First bite attempt used `kind='test'` which failed `work_log_kind_check` (valid kinds: `decision / shipped / published / research / draft / note / blocker_cleared / meeting / retro`) before the FK could fire. Re-ran with `kind='note'` — both FK violations captured cleanly. Noted for future bite tests touching `work_log`.

## README update

Added "Adding a new workstream" section to `/Users/edmundmitchell/factory/dashboard/supabase/README.md`. Explains the naming collision in one paragraph, gives the `INSERT ... ON CONFLICT DO NOTHING` pattern, documents the `kind` / `status` CHECK enums, and the "set `status='retired'` rather than DELETE" retirement rule.

## Surprises

1. **Naming collision with portfolio `projects` table** — already addressed above. Recorded as a workstream-naming decision in this log; recommend a brief entry in `03-decisions/decisions-log.md` if you want the rationale in the canonical decisions surface.
2. **`work_log_kind_check` ambush** — bite-test prompts in future epics should default to `kind='note'` (guaranteed valid).

## Follow-ups

- **DC client scope content enrichment** — 5 of 9 scope docs carry `metadata.needs_enrichment=true` (all three DC sub-clients + zpm + real-true + faith-ai). Bodies are placeholder "TBD" stubs. Edmund should fill in: retainer amount/cadence, contact person, concrete deliverables, drift-risks specific to each. Suggested surface: a short `/scopes` dashboard page (could roll into W7.2c) that renders each scope doc with an "edit" affordance.
- **`03-decisions/decisions-log.md` entry** — the `workstreams`-not-`projects` naming decision is currently only recorded here + in the migration file comments. Worth lifting to the decisions log for future-Edmund discoverability.
- **W7.2c `/clients` dashboard surface** — now unblocked. Queries can assume `workstreams` exists and FK is valid.
- **Kardia CLAUDE.md references** — W7.2d already shipped with SQL referencing `work_log.project` values; no change needed there, but worth a diff-check that none of the canonical SQL hardcoded a table named `projects`.

## RLS posture

Confirmed per Edmund's guidance: no RLS policies created on `workstreams`. Server-side reads from dashboard use service-role which bypasses RLS. The pre-existing `public.projects` portfolio table retains its RLS policies untouched.
