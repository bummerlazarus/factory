# Autonomous run — W9.1b schema cleanup (destructive)

**Date:** 2026-04-17
**Status:** 🟢 DONE
**Epic:** W9.1b
**Project:** Supabase `obizmgugsqirmnjpirnh`
**Migration name (applied):** `schema_cleanup_destructive_2026_04_17`
**Edmund approval:** Carried forward from `06-handoffs/2026-04-17-late-evening-handoff.md` § "Edmund's approvals carried forward" item 2.

## Plan

Three drops, nothing else:

1. `DROP TABLE public.scheduled_tasks` — 7 rows, zero inbound FKs, superseded by `public.agent_scheduled_tasks`.
2. `DROP TABLE public.agent_habits` — 0 rows, zero inbound FKs, never populated.
3. `DROP EXTENSION "uuid-ossp"` — W9.1a already moved every UUID default to `gen_random_uuid()`. Verify via `pg_depend` there are zero non-`public` dependents before dropping; STOP if any appear.

## Pre-drop verification

All four guard queries came back clean.

### Inbound FKs on `public.scheduled_tasks`

```sql
SELECT conname, conrelid::regclass FROM pg_constraint
WHERE confrelid = 'public.scheduled_tasks'::regclass;
-- => []
```

**0 rows.** Orphan confirmed.

### Inbound FKs on `public.agent_habits`

```sql
SELECT conname, conrelid::regclass FROM pg_constraint
WHERE confrelid = 'public.agent_habits'::regclass;
-- => []
```

**0 rows.** Orphan confirmed.

### Functions referencing `uuid_generate_v4`

```sql
SELECT n.nspname, p.proname FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prokind = 'f'
  AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND pg_get_functiondef(p.oid) ILIKE '%uuid_generate_v4%';
-- => [{"nspname":"extensions","proname":"uuid_generate_v4"}]
```

The only hit is the extension's own function (`extensions.uuid_generate_v4`), which gets dropped by the `DROP EXTENSION` itself. No user-defined function or trigger references it. (Note: initial probe over `pg_proc` included aggregates and errored on `array_agg`; re-ran with `p.prokind = 'f'` — behavior-preserving.)

### `pg_depend` non-extension dependents of `uuid-ossp`

```sql
SELECT DISTINCT d.deptype, d.classid::regclass AS dependent_class, d.objid,
  n.nspname AS dependent_schema,
  COALESCE(c.relname, p.proname, t.typname, ''::text) AS dependent_name
FROM pg_depend d
LEFT JOIN pg_class c ON d.classid = 'pg_class'::regclass AND c.oid = d.objid
LEFT JOIN pg_proc p ON d.classid = 'pg_proc'::regclass AND p.oid = d.objid
LEFT JOIN pg_type t ON d.classid = 'pg_type'::regclass AND t.oid = d.objid
LEFT JOIN pg_namespace n ON n.oid = COALESCE(c.relnamespace, p.pronamespace, t.typnamespace)
WHERE d.refobjid = (SELECT oid FROM pg_extension WHERE extname = 'uuid-ossp')
  AND d.deptype != 'e';
-- => []
```

**0 rows.** Nothing outside the extension itself depends on it. Safe to drop.

### Row counts (sanity)

```sql
SELECT 'scheduled_tasks' AS tbl, COUNT(*) FROM public.scheduled_tasks
UNION ALL SELECT 'agent_habits', COUNT(*) FROM public.agent_habits;
-- => scheduled_tasks=7, agent_habits=0
```

Matches W9.1a's reported state.

## Migration SQL

```sql
-- W9.1b — destructive schema cleanup (Edmund approved 2026-04-17)
-- Drops orphaned tables + uuid-ossp extension. W9.1a already migrated
-- every UUID default to gen_random_uuid().
DROP TABLE IF EXISTS public.scheduled_tasks CASCADE;
DROP TABLE IF EXISTS public.agent_habits CASCADE;
DROP EXTENSION IF EXISTS "uuid-ossp";
```

`apply_migration` returned `{"success":true}`.

## Post-drop verification

### Tables gone

```sql
SELECT to_regclass('public.scheduled_tasks'), to_regclass('public.agent_habits');
-- => {"scheduled_tasks":null,"agent_habits":null}
```

Both `NULL`. Tables dropped.

### Extension gone

```sql
SELECT extname FROM pg_extension WHERE extname = 'uuid-ossp';
-- => []
```

Extension dropped.

### `public` defaults re-confirmed clean

```sql
SELECT COUNT(*) FROM information_schema.columns
WHERE table_schema='public' AND column_default ILIKE '%uuid_generate_v4%';
-- => 0
```

No regressions introduced since W9.1a.

## Subagents dispatched

None. Single-session execution — scope was too narrow to justify.

## Decisions

- **Widened the function probe scope.** Original guard query restricted the namespace filter to exclude `pg_catalog`/`information_schema` but didn't restrict by kind; `pg_get_functiondef` errors on aggregates. Re-ran with `p.prokind = 'f'` (plain functions only). Same intent, doesn't miss anything that could plausibly call `uuid_generate_v4()`.
- **Did not drop `extensions.uuid_generate_v4` separately.** `DROP EXTENSION` already removes every function created by the extension; the `pg_proc` hit is expected and self-resolving.

## Follow-ups

- None required for W9.1b. The `reference_docs` CHECK rework (W9.1c) already shipped earlier today.
- W9.2 (Q10 security hardening) remains blocked on Edmund decision.

## Artifacts

- This run log: `architecture rebuild 2026-04-17/06-handoffs/autonomous-runs/2026-04-17-w9-1b-schema-cleanup-destructive.md`
- Sibling additive run log: `architecture rebuild 2026-04-17/06-handoffs/autonomous-runs/2026-04-17-w9-1-schema-cleanup-additive.md`
- Backlog entry updated: `architecture rebuild 2026-04-17/06-handoffs/backlog.md` row W9.1b
