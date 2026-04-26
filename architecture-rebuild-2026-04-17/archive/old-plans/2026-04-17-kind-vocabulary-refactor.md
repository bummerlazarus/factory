# W9.1c — Kind-vocabulary refactor — plan

**Date:** 2026-04-17
**Backlog entry:** W9.1c (Wave 9 Cleanup)
**Status when plan written:** ⚪ → targeting 🟢

---

## Why

`reference_docs.kind` was gated by a `CHECK (kind IN (...))` constraint. Over a
single day that constraint was rewritten four times as different Skills
extended the vocabulary:

1. W5.8 added `'promotion'`
2. W5.9 added `'educated-bet'`
3. W6.4 added `'pain-point-cluster'` — **silently dropped `'educated-bet'`**, which
   would have broken the `educated-bets-weekly` pg_cron the next time it ran
4. W6.2a added `'theme'` — noticed the W6.4 regression and restored `'educated-bet'`
5. W6.2b (landed just before this refactor) added `'connection'`

That pattern is a timebomb. Every future Skill that wants a new kind has to
re-list every other Skill's kinds correctly, or silently break the system.

## Fix

Lift the vocabulary out of the constraint and into a proper reference table
`public.reference_docs_kinds`. Replace the CHECK with a FOREIGN KEY.

Adding a new kind becomes:

```sql
INSERT INTO public.reference_docs_kinds (kind, description)
VALUES ('my-new-kind', 'Short description')
ON CONFLICT (kind) DO NOTHING;
```

An additive INSERT cannot regress another Skill's kind. Enforcement is the
same (the FK rejects any `reference_docs.kind` that isn't in the table).

## Shape

Single migration `20260417140000_reference_docs_kinds_table.sql`:

1. `CREATE TABLE IF NOT EXISTS public.reference_docs_kinds (kind text PK, description text, added_at timestamptz default now())`
2. Seed the 14 documented kinds with `ON CONFLICT DO NOTHING`.
3. **Safety net:** `INSERT ... SELECT DISTINCT rd.kind ... WHERE rdk.kind IS NULL` — any
   existing `reference_docs.kind` value missing from the seed gets auto-added with
   description `'historical, auto-added during FK migration'`. This is the
   belt-and-braces guard: if a past rewrite allowed rows with kinds not in the
   current documented list, we preserve them instead of failing the FK add.
4. `ALTER TABLE ... DROP CONSTRAINT IF EXISTS reference_docs_kind_check`
5. `ALTER TABLE ... ADD CONSTRAINT reference_docs_kind_fk FOREIGN KEY (kind) REFERENCES reference_docs_kinds(kind)` (guarded by a `DO $$ … IF NOT EXISTS … $$` so re-apply is a no-op).

Every statement is idempotent — `IF NOT EXISTS` / `ON CONFLICT` / `DROP IF EXISTS`.

## What this migration does NOT do

- **Does not touch past Skill migration files.** Those are historical; the
  constraint rewrites stay as-is. Only the live database state changes.
- **Does not touch `reference_docs` columns.** Only the constraint changes.
- **Does not add `connection` preemptively** via the seed — but the safety-net
  step (step 3 above) auto-captures it if W6.2b has already landed.

## Convention for future Skill migrations

Documented in the migration header comment AND in `dashboard/supabase/README.md`:
Skills that need a new kind should just `INSERT INTO public.reference_docs_kinds`
with `ON CONFLICT DO NOTHING`. Do NOT rewrite the FK.

## Verification plan

1. `SELECT count(*) FROM public.reference_docs_kinds;` — expect ≥14 (15 if W6.2b landed).
2. `SELECT conname FROM pg_constraint WHERE conrelid = 'public.reference_docs'::regclass;`
   — expect `reference_docs_kind_fk`, NOT `reference_docs_kind_check`.
3. Positive insert test: `INSERT ... kind='theme'` — should succeed.
4. Negative insert test: `INSERT ... kind='totally-fake-kind'` — should fail with
   `23503` FK violation.
5. Idempotent re-apply: rerun every statement; expect zero new rows, active
   constraint still `reference_docs_kind_fk`.

## Rollback

Inline at the top of the migration file.

```sql
BEGIN;
  ALTER TABLE public.reference_docs DROP CONSTRAINT IF EXISTS reference_docs_kind_fk;
  ALTER TABLE public.reference_docs ADD CONSTRAINT reference_docs_kind_check
    CHECK (kind IN ('goal','value','kpi','framework','claude_md','principle',
                    'persona','playbook','doc','cluster','promotion',
                    'educated-bet','pain-point-cluster','theme'));
  DROP TABLE IF EXISTS public.reference_docs_kinds;
COMMIT;
```
