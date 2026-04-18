# W6.2a — Research-director: Emergent-theme SQL scan — Run Log

**Date:** 2026-04-17
**Status:** 🟢 Shipped
**Agent:** Autonomous subagent (factory top-level)
**Plan:** `/05-design/plans/2026-04-17-w6-2a-research-director-themes.md`
**Parent plan:** `/05-design/plans/2026-04-17-w6-2-research-director-split.md`
**Migration:** `dashboard/supabase/migrations/20260417120000_research_director_themes.sql`

---

## 1. Pre-flight recon

Current state of the database before the migration:

- `memory` table: 13,199 rows with `embedding IS NOT NULL`, namespaces `{knowledge: 12,790, content: 208, conversations: 201}`. All rows `created_at` in a narrow band on 2026-04-17 (today).
- `memory.embedding` dimension: 1536 (not 3072 — the 3072 in `reference_rebuild_artifacts.md` refers to Pinecone, not the Supabase mirror).
- HNSW index `idx_memory_embedding_hnsw` using `vector_cosine_ops` exists on `public.memory(embedding)`. ✓
- `reference_docs`: 1 row total (kind=`framework`); unique index on `slug` exists; `BEFORE UPDATE` trigger `trg_reference_docs_set_updated_at` keeps `updated_at` current.
- `cron.job` contents before: `librarian-daily`, `double-down-nightly`, `educated-bets-weekly`, `audience-painpoints-weekly`. No `research-director-weekly`.

## 2. Constraint drift finding (important)

Task brief said the existing CHECK listed 13 values including `educated-bet`. Live query disagreed — the actual constraint had **12** values, missing `educated-bet`:

```
CHECK (kind IN (
  goal, value, kpi, framework, claude_md, principle,
  persona, playbook, doc, cluster, promotion, pain-point-cluster
))
```

Root cause: W6.4 `20260417110000_audience_pain_points.sql` does a `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT ...` and silently dropped `'educated-bet'` that W5.9 had added. The `educated-bets-weekly` cron job exists in `cron.job` but any run attempting to INSERT a `kind='educated-bet'` row would error on the check.

This migration restores `'educated-bet'` additively (14 values total now) and adds `'theme'`.

## 3. Migration applied

Applied via Supabase MCP `apply_migration` with name `research_director_themes`. Result: `{"success":true}`. Listed as version `20260417120000` in `list_migrations`.

Constraint after (from `pg_get_constraintdef`):
```
CHECK ((kind = ANY (ARRAY[
  'goal'::text, 'value'::text, 'kpi'::text, 'framework'::text,
  'claude_md'::text, 'principle'::text, 'persona'::text, 'playbook'::text,
  'doc'::text, 'cluster'::text, 'promotion'::text, 'educated-bet'::text,
  'pain-point-cluster'::text, 'theme'::text
])))
```

## 4. Verification outputs

### 4.1 Empty-window run

The task's spec called for `research_director_themes(1, 1, 10, 0.78)`. Because today's ingest placed all 13k+ memory rows in a narrow window of roughly 8 hours on 2026-04-17, a 1-day lookback still captures them (processed=1000). To exercise the `processed=0` path cleanly, I used `window_days=0`, which makes `window_start == window_end` and yields zero matching rows.

```sql
SELECT public.research_director_themes(0, 1, 10, 0.78);
```

```json
{
  "note": "no memory rows with embeddings in window",
  "processed": 0,
  "window_end":   "2026-04-17T22:11:02.807427+00:00",
  "baseline_end": "2026-04-17T22:11:02.807427+00:00",
  "window_start": "2026-04-17T22:11:02.807427+00:00",
  "baseline_start": "2026-04-16T22:11:02.807427+00:00",
  "themes_written": 0,
  "similarity_threshold": 0.78
}
```

### 4.2 Real-data historical run

```sql
SELECT public.research_director_themes(3650, 3650, 10, 0.78);
```

```json
{
  "top_n": 10,
  "processed": 1000,
  "window_end":   "2026-04-17T22:11:07.099529+00:00",
  "baseline_end": "2016-04-19T22:11:07.099529+00:00",
  "window_start": "2016-04-19T22:11:07.099529+00:00",
  "baseline_start": "2006-04-22T22:11:07.099529+00:00",
  "themes_written": 7,
  "similarity_threshold": 0.78
}
```

Top themes produced (trimmed):

| cluster_size | distinct sources | namespaces | title (head) |
|---:|---|---|---|
| 18 | 1 (`conversation`) | `conversations` | "User: Can you summarize the latest podcast video about the Pope..." |
| 11 | 2 (`csv`, `markdown`) | `knowledge` | "\| : No \| : 7 \| : Workshop + Course \| : All parish ministers..." |
| 7 | 1 (`website`) | `content` | "Our Lady of La Salette and Our Lady of the Golden Heart..." |
| 4 | 1 (`conversation`) | `conversations` | "User: can you ingest this: youtube.com/shorts/..." |
| 3 | 1 (`conversation`) | `conversations` | "User: Hello Assistant: Hey there!..." |
| 2 | 1 (`conversation`) | `conversations` | "User: 5 Assistant: Here are five YouTube video ideas..." |
| 2 | 1 (`conversation`) | `conversations` | "User: try writing to creator engine in notion..." |

One theme organically spans ≥2 sources (parish-ministry theme — csv + markdown). Most themes are single-source because today's corpus is dominated by a few dense single-source sub-corpora (podcast transcripts, website dumps). This is a corpus characteristic, not a bug.

### 4.3 Seeded positive-path test

Deleted all themes produced above. Inserted 5 synthetic memory rows — 3 sharing a "lonely" embedding (found by sampling the lowest-neighbor embeddings in the corpus), across 3 namespaces and 2 distinct sources (`w62a_seed`, `w62a_seed_alt`), plus 2 truly unrelated rows.

```sql
-- anchor embedding: 0ba067b5-c96b-4964-a188-14a9cf576bc1 (neighbors=1 in full corpus)
-- seeds (id, namespace, source, source_id):
--   25630038... knowledge     w62a_seed     seed-dup-1
--   8c055c71... content       w62a_seed_alt seed-dup-2
--   f3f35528... conversations w62a_seed     seed-dup-3
--   5cc3c536... knowledge     w62a_seed     seed-unrel-4  (unrelated)
--   95ac37f8... knowledge     w62a_seed     seed-unrel-5  (unrelated)
```

First run with default `top_n=10` did NOT surface the seed cluster: today's corpus has 139 rows with density ≥ 3, so the seed pool (top_n\*5 = 50) was filled by much denser real clusters. Using `top_n=50` (seed pool = 250) to ensure the 3-row seed cluster enters the pool, the function produced it:

```sql
SELECT public.research_director_themes(1, 1, 50, 0.78);
-- {"top_n":50,"processed":1000,"themes_written":43,...}
```

Seed theme row (the key acceptance check):

```json
{
  "slug": "theme-2026-04-17-f67be697",
  "version": 1,
  "title": "Theme 2026-04-17 — W6.2a seed-1 near-dup theme A",
  "cluster_size": 3,
  "member_sources": ["w62a_seed", "w62a_seed_alt"],
  "member_namespaces": ["content", "conversations", "knowledge"],
  "distinct_source_count": 2,
  "density_score": 2,
  "exemplar_memory_id": "25630038-3939-4085-96c1-94829bd644a3",
  "member_memory_ids": [
    "25630038-3939-4085-96c1-94829bd644a3",
    "8c055c71-202b-445d-85b5-584b9997ffd1",
    "f3f35528-2087-4d3f-8f8b-6adac561a979"
  ],
  "similarity_threshold": 0.78
}
```

Body preview:

```
Auto-generated by Research-director (W6.2a).

Window:   2026-04-16 22:30 UTC -> 2026-04-17 22:30 UTC
Baseline: 2026-04-15          -> 2026-04-16
Members: 3
Sources: w62a_seed, w62a_seed_alt
Namespaces: content, conversations, knowledge
Density: 2.00

## Members
- W6.2a seed-1 near-dup theme A (source=w62a_seed, namespace=knowledge)
- W6.2a seed-2 near-dup theme A variant (source=w62a_seed_alt, namespace=content)
- W6.2a seed-3 near-dup theme A another variant (source=w62a_seed, namespace=conversations)
```

Acceptance all met:
- cluster_size=3 ✓
- distinct member_sources length ≥ 2 ✓
- body lists each member tagged `(source=..., namespace=...)` ✓
- metadata carries all required fields ✓

### 4.4 Idempotency

Re-ran the same call: `SELECT public.research_director_themes(1, 1, 50, 0.78);`

- total themes: **43** → **43** (no duplicate slugs created)
- seed theme `version`: **1** → **2** ✓
- seed theme `member_sources`, `cluster_size`: unchanged ✓
- ON CONFLICT DO UPDATE with `version = version + 1` and `updated_at = now()` behaved exactly as intended ✓

### 4.5 Cron registration

```sql
SELECT jobname, schedule, command FROM cron.job WHERE jobname='research-director-weekly';
```

```
jobname                    schedule     command
research-director-weekly   0 7 * * 1     SELECT public.research_director_themes(7, 90, 10, 0.78);
```

✓

### 4.6 Cleanup

```sql
DELETE FROM public.memory         WHERE source IN ('w62a_seed','w62a_seed_alt');
DELETE FROM public.reference_docs WHERE kind='theme';
```

Post-cleanup: `remaining_seeds=0`, `remaining_themes=0`. ✓

## 5. Deliverables check

| Deliverable | Path | Status |
|---|---|---|
| Migration | `dashboard/supabase/migrations/20260417120000_research_director_themes.sql` | 🟢 applied |
| Sub-plan doc | `architecture rebuild 2026-04-17/05-design/plans/2026-04-17-w6-2a-research-director-themes.md` | 🟢 written |
| Run log | this file | 🟢 written |
| Backlog flip | W6.2a → 🟢, W6.2 stays 🔵 (partial) | 🟢 (see backlog) |

## 6. Follow-ups

1. **Kind-vocabulary drift is a recurring pattern.** Two migrations in a single day (W5.9 added `educated-bet`; W6.4 silently dropped it). Lift the kind set into a `reference_docs_kinds(kind text primary key)` table with a foreign-key on `reference_docs.kind`; every new kind becomes an INSERT instead of a DROP+ADD on the CHECK. Low-cost migration, high drift-prevention value.
2. **Real-corpus themes skew single-source.** Today's corpus is dominated by dense single-source sub-corpora (podcast transcripts, website dumps). Once the W6.2d dashboard is live, consider promoting a "cross-silo connections" surface (W6.2b) earlier than sequenced — it's the feature that delivers visible multi-source insight fastest.
3. **`top_n=10` is aggressive for seed coverage.** On a densely-clustered corpus, a modest 3-row emergent theme won't rise into the seed pool. Acceptable for "find the biggest emergent themes", but if you want broader theme surfacing, raise the default to 20-25 or decouple seed-pool size from `top_n` (e.g. `seed_pool = 250 + top_n * 10`).
4. **Baseline random sampling is stochastic.** Two identical runs can produce slightly different density scores because the 1000-row baseline sample changes. The `theme-<date>-<md5(exemplar_id)[0:8]>` slug keys on the exemplar, so variance shows up as version bumps rather than new slugs — fine for v1, flag if cluster exemplars start oscillating week-to-week.
5. **Real density is sensitive to the narrow ingest-time band.** All 13k memory rows were backfilled today, so the 90-day baseline is currently empty — every density score collapses to `sim_to_window / 1`. Once ingest spans multiple days organically, density will meaningfully distinguish emergent from background topics.
