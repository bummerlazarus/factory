# W6.2b — Research-director: Cross-silo connections SQL scan — Plan

**Date:** 2026-04-17
**Status:** 🟢 Shipped
**Parent plan:** `./2026-04-17-w6-2-research-director-split.md`
**Sibling (shipped):** `./2026-04-17-w6-2a-research-director-themes.md`
**Migration:** `dashboard/supabase/migrations/20260417130000_research_director_connections.sql`
**Run log:** `../06-handoffs/autonomous-runs/2026-04-17-w6-2b-research-director-connections.md`

---

## 1. Scope

Second sub-epic of the W6.2 research-director split. W6.2a finds dense
clusters (emergent themes). W6.2b finds **cross-silo PAIRS** — two
`memory` rows with high embedding similarity where the two members come
from DIFFERENT `memory.source` values. These are the "same idea is
surfacing in multiple streams" moments (e.g. pdf ↔ youtube, capture ↔
conversation, csv ↔ markdown).

Pure SQL. No LLM. W6.2c will layer synthesis on top.

## 2. Deliverables

1. Migration file `20260417130000_research_director_connections.sql`
2. Function `public.research_director_connections(window_days, top_n, similarity_threshold)` returning `jsonb`
3. `reference_docs.kind` CHECK constraint extended with `'connection'`
   (15 values total; preserves all 14 existing values from post-W6.2a state)
4. Cron job `research-director-weekly` updated to chain both scans
5. Backlog row W6.2b flipped to 🟢

## 3. Design

### Function signature

```sql
public.research_director_connections(
  window_days integer DEFAULT 7,
  top_n integer DEFAULT 10,
  similarity_threshold double precision DEFAULT 0.80
) RETURNS jsonb
```

`SECURITY DEFINER`, `search_path = public, pg_temp`. Mirrors W6.2a.

### Algorithm

1. Collect `memory` rows in window (namespaces
   `knowledge`/`content`/`conversations`, `embedding IS NOT NULL`,
   `created_at >= now() - window_days`). Cap 2000 most recent.
2. Cross-pair query — pairwise join with `a.id < b.id` (dedupe),
   `a.source <> b.source` (cross-silo), `similarity > threshold`.
   Order DESC, `LIMIT top_n`.
3. Upsert one `reference_docs` row per pair:
   - `slug = 'connection-<YYYY-MM-DD>-<md5(a_id || b_id)[0:8]>'`
   - `title = 'Connection <date> — <a_source> <-> <b_source> (<sim>)'`
   - `body`: header + 200-char snippets for each member tagged
     `(source=X, namespace=Y)` + similarity footer
   - `metadata`: `{window_start, window_end, a_memory_id, b_memory_id,
     a_source, b_source, a_namespace, b_namespace, similarity,
     similarity_threshold, generator, generated_at}`
4. `ON CONFLICT (slug) DO UPDATE SET title, body, metadata,
   version = version+1, updated_at = now()`.

### Zero-data

Empty window → `{processed:0, connections_written:0, note:"no memory
rows with embeddings in window"}`. A populated window with no pairs
above threshold → `{processed:N, connections_written:0, note:"no
cross-source pairs above similarity threshold"}`.

### Bounded cost

Window capped at 2000. Pairwise query pruned by `a.id < b.id` +
`a.source <> b.source` + distance threshold (HNSW index
`idx_memory_embedding_hnsw` accelerates `<=>`). `LIMIT top_n` on the
pre-materialised `_pairs` temp table keeps render work small.

### Schedule

Chains into `research-director-weekly` (Mondays 07:00 UTC). The single
call becomes two sequential SELECTs:

```
SELECT public.research_director_themes(7, 90, 10, 0.78);
SELECT public.research_director_connections(7, 10, 0.80);
```

Unschedule-then-schedule dance (cron.schedule raises on duplicate
jobname).

## 4. Idempotency

Deterministic slug (`md5(a_id || b_id)[0:8]` + window_end date) plus
`ON CONFLICT (slug) DO UPDATE` with `version = version+1`. Same-week
re-runs refresh content without duplicating rows.

## 5. Acceptance criteria

1. Constraint extended with `connection` (15 values, all prior values preserved)
2. Empty-window run: `{connections_written:0, note:"no memory rows..."}`
3. Real-data run produces ≤ top_n rows, all with `a_source <> b_source`
4. Sample row has non-empty `title`, `body`, `metadata.similarity > threshold`
5. Re-run bumps `version` without duplicating slugs
6. `cron.job.command` for `research-director-weekly` contains both
   `research_director_themes` and `research_director_connections`

## 6. Constraints

- No LLM calls (W6.2c future work)
- Under 300 SQL lines
- Do not modify `research_director_themes`
- Do not touch `content_metrics_unified` view
- Preserve `educated-bet` and every other existing kind in the CHECK
  constraint — the W6.4 agent already regressed this once (W6.2a run
  log documents the restore)

## 7. Rollback

Documented in migration header. Summary:

```sql
SELECT cron.unschedule('research-director-weekly');
SELECT cron.schedule('research-director-weekly', '0 7 * * 1',
  $$ SELECT public.research_director_themes(7, 90, 10, 0.78); $$);
DROP FUNCTION IF EXISTS public.research_director_connections(int, int, double precision);
DELETE FROM public.reference_docs WHERE kind='connection';
ALTER TABLE public.reference_docs DROP CONSTRAINT reference_docs_kind_check;
ALTER TABLE public.reference_docs ADD CONSTRAINT reference_docs_kind_check
  CHECK (kind IN ('goal','value','kpi','framework','claude_md','principle',
                  'persona','playbook','doc','cluster','promotion',
                  'educated-bet','pain-point-cluster','theme'));
```
