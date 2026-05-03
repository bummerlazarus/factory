# Autonomous run — W9.1c Kind-vocabulary refactor

**Date:** 2026-04-17
**Status:** 🟢 Shipped
**Project:** Supabase `obizmgugsqirmnjpirnh`
**Migration file:** `dashboard/supabase/migrations/20260417140000_reference_docs_kinds_table.sql`
**Migration name (applied):** `reference_docs_kinds_table`

---

## What ran

Lifted `reference_docs.kind` vocabulary out of a CHECK constraint and into a
proper reference table `public.reference_docs_kinds` with a FOREIGN KEY from
`reference_docs.kind`. Future Skills that need a new kind `INSERT` a row —
no more CHECK rewrites, no more silent regressions (see W6.4 dropping
`'educated-bet'` from the constraint earlier today).

## Constraint audit — BEFORE

Method: `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.reference_docs'::regclass;`

Active before the run:

```
reference_docs_kind_check
  CHECK ((kind = ANY (ARRAY['goal', 'value', 'kpi', 'framework', 'claude_md',
                            'principle', 'persona', 'playbook', 'doc', 'cluster',
                            'promotion', 'educated-bet', 'pain-point-cluster',
                            'theme'])))
```

14 values. `'connection'` from W6.2b was NOT in the documented CHECK list at
the moment I captured this snapshot — see "Orphan kinds" below.

## Orphan kinds — auto-INSERTed

The migration's safety-net step (step 3 in the plan) does:

```sql
INSERT INTO public.reference_docs_kinds (kind, description)
SELECT DISTINCT rd.kind, 'historical, auto-added during FK migration'
FROM public.reference_docs rd
LEFT JOIN public.reference_docs_kinds rdk ON rdk.kind = rd.kind
WHERE rdk.kind IS NULL
ON CONFLICT (kind) DO NOTHING;
```

That captured **one orphan: `'connection'`** — W6.2b had already landed 10
`reference_docs` rows with `kind='connection'` (titles: `Connection 2026-04-17
— csv <-> markdown (0.84)`, …). These rows were inserted before my migration
and the CHECK snapshot I captured didn't list `'connection'` — W6.2b must have
rewritten it at some point and I caught the DB between rewrites. Either way,
the safety net picked it up.

After the migration I hand-upgraded the `connection` description from the
generic `'historical, auto-added during FK migration'` to:

> `W6.2b Research-director Skill — cross-silo pair connections from semantic similarity scan.`

Net effect: every existing `reference_docs` row's kind is in the vocabulary
table. FK add succeeds without touching a single row.

## Final `reference_docs_kinds` row count

**15 rows.** 14 from the documented seed + 1 (`connection`) captured by the
safety net. List:

```
claude_md, cluster, connection, doc, educated-bet, framework, goal, kpi,
pain-point-cluster, persona, playbook, principle, promotion, theme, value
```

## Constraint — AFTER

```
reference_docs_kind_fk  FOREIGN KEY (kind) REFERENCES reference_docs_kinds(kind)
reference_docs_pkey     PRIMARY KEY (id)
reference_docs_slug_key UNIQUE (slug)
reference_docs_version_check  CHECK ((version >= 1))
```

`reference_docs_kind_check` — **gone**. `reference_docs_kind_fk` — confirmed
via `pg_constraint`.

## Positive + negative insert tests

**Positive:** `INSERT ... (slug='w9-1c-fk-test-positive', kind='theme')` →
succeeded, returning id `d93e5232-e01f-458b-9ff7-c75cdf7ef852`. Cleaned up
immediately via `DELETE FROM reference_docs WHERE slug='w9-1c-fk-test-positive'`.

**Negative:** `INSERT ... (kind='totally-fake-kind')` →

```
ERROR:  23503: insert or update on table "reference_docs" violates foreign key constraint "reference_docs_kind_fk"
DETAIL:  Key (kind)=(totally-fake-kind) is not present in table "reference_docs_kinds".
```

Exactly as expected. No row inserted, nothing to clean up.

## Idempotent re-apply

Re-ran every statement from the migration body via `execute_sql` (can't
re-apply the same named migration through `apply_migration`). Result:

- `CREATE TABLE IF NOT EXISTS` — no-op.
- 14 seed INSERTs with `ON CONFLICT DO NOTHING` — 0 new rows.
- Orphan `INSERT ... SELECT DISTINCT` — 0 new rows.
- `DROP CONSTRAINT IF EXISTS reference_docs_kind_check` — already gone, no-op.
- Guarded `ADD CONSTRAINT reference_docs_kind_fk` — already present, no-op via
  the `DO $$ IF NOT EXISTS $$` guard.

Post-re-run audit returned `{kinds_count: 15, active_constraint: reference_docs_kind_fk}`.
Migration is cleanly idempotent.

## Convention doc

Two places:

1. `dashboard/supabase/README.md` — new "Adding a new reference_docs kind"
   section (file created fresh; no README existed before).
2. Migration header comment — `20260417140000_reference_docs_kinds_table.sql`
   lines 17–26 under the `CONVENTION` heading.

Future Skill migrations should `INSERT INTO reference_docs_kinds` with
`ON CONFLICT DO NOTHING` rather than rewriting the FK.

## Nothing destructive was run

- No DROP TABLE, no TRUNCATE, no DELETE against real data.
- DELETE was used once, for the W9.1c test row with slug
  `w9-1c-fk-test-positive` I inserted for the positive test.
- The CHECK constraint was dropped and replaced with a functionally-equivalent
  FK; no data lost, every pre-existing `reference_docs` row still valid.

## Artifacts

- Migration: `dashboard/supabase/migrations/20260417140000_reference_docs_kinds_table.sql`
- Plan: `architecture-rebuild-2026-04-17/05-design/plans/2026-04-17-kind-vocabulary-refactor.md`
- Run log: this file
- README: `dashboard/supabase/README.md`
- Backlog entry: W9.1c in `architecture-rebuild-2026-04-17/06-handoffs/backlog.md`

## Notable observations

- W6.2b Cross-silo connections Skill **has already landed** (10 `connection`
  rows in `reference_docs`, created ~30 seconds before this migration). The
  backlog still shows W6.2b as `⚪ not started` but the data says otherwise.
  Flagging for Edmund — the backlog row likely needs to be flipped to 🟢 and a
  run log written for it, but that's outside the scope of W9.1c.
- The whole motivating incident (W6.4 silently dropping `'educated-bet'`) is
  now structurally impossible. A Skill would need to explicitly DELETE from
  `reference_docs_kinds` to regress another Skill's kind — and DELETE is
  flagged as destructive in the autonomy charter.
