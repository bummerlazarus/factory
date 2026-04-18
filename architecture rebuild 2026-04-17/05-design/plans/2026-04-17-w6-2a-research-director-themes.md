# W6.2a — Research-director: Emergent-theme SQL scan (sub-plan)

**Date:** 2026-04-17
**Status:** Shipped. 🟢
**Parent:** `2026-04-17-w6-2-research-director-split.md`
**Run log:** `/06-handoffs/autonomous-runs/2026-04-17-w6-2a-research-director-themes.md`

---

## 1. What this ships

One Postgres function + one pg_cron job + one additive CHECK-constraint bump.

- `public.research_director_themes(window_days, baseline_days, top_n, similarity_threshold) RETURNS jsonb`
- `research-director-weekly` cron, Mondays 07:00 UTC, calls `research_director_themes(7, 90, 10, 0.78)`
- `reference_docs.kind` CHECK extended to include `'theme'` (and restores `'educated-bet'` which was accidentally dropped by W6.4 — see constraint-drift note below)

Migration: `dashboard/supabase/migrations/20260417120000_research_director_themes.sql` (388 lines, under the 400 budget).

## 2. Algorithm summary

Pure SQL. No LLM calls (W6.2c synthesizes later).

1. **Window:** `memory` rows with `namespace IN ('knowledge','content','conversations')` and `embedding IS NOT NULL` in the last `window_days`. Cap 1000 most-recent.
2. **Baseline:** random-sample 1000 rows from the `baseline_days` preceding the window.
3. **Density scoring:** per window row compute
   - `sim_to_window` = count of window neighbors with similarity > threshold (minus self)
   - `sim_to_baseline` = count of baseline neighbors above threshold
   - `density_score = sim_to_window / GREATEST(sim_to_baseline, 1)`
4. **Seed pool:** top `top_n * 5` rows by density (only rows with at least one window neighbor).
5. **Edges:** pairwise over seeds, `a.id < b.id` AND `(1 - cos_dist) > threshold`. HNSW index `idx_memory_embedding_hnsw` accelerates.
6. **Connected components** via recursive CTE + min-node aggregation (W6.1 pattern). Drop singletons. Cap at `top_n` clusters.
7. **Exemplar per cluster:** highest density_score, tiebreak newest `created_at`.
8. **Row shape:** slug `theme-<YYYY-MM-DD>-<md5(exemplar_id)[0:8]>`, bulleted body with 200-char `(source=..., namespace=...)` snippets, metadata with `window_*`, `baseline_*`, `cluster_size`, `member_memory_ids`, distinct `member_sources`, distinct `member_namespaces`, `exemplar_memory_id`, `density_score`, `similarity_threshold`, `generator`, `generated_at`.
9. **Idempotency:** `ON CONFLICT (slug) DO UPDATE SET title, body, metadata, version = version+1, updated_at = now()`.

## 3. Zero-data and failure modes

- Empty window → returns `{processed:0, themes_written:0, note:"no memory rows with embeddings in window"}`.
- Window non-empty but no seed exceeded threshold → returns `{processed:N, themes_written:0, note:"no window rows had a neighbor above threshold"}`.
- Seeds exist but no cluster of size ≥2 after edges → 0 themes written, no error.

## 4. Acceptance (met)

1. Zero-data run returns cleanly. ✓
2. Seeded positive path produces ≥1 theme spanning ≥2 distinct `memory.source` values. ✓
3. Idempotent on `theme-<date>-<md5[0:8]>`; version bumps on re-run. ✓
4. `research-director-weekly` cron scheduled Mondays 07:00 UTC. ✓
5. `reference_docs.kind` CHECK extended additively to include `'theme'`. ✓

## 5. Constraint drift note (important)

Before this migration, `reference_docs_kind_check` listed 12 values:
`{goal, value, kpi, framework, claude_md, principle, persona, playbook, doc, cluster, promotion, pain-point-cluster}`.

The W5.9 migration (`20260417100000_educated_bets_skill.sql`) **did** add `'educated-bet'`, but the subsequent W6.4 migration (`20260417110000_audience_pain_points.sql`) performed a drop-then-recreate on the same constraint and **omitted `'educated-bet'`**. The `educated-bets-weekly` cron job therefore would have failed on insert until this migration silently restored the value.

Post-migration constraint has 14 values:
`{goal, value, kpi, framework, claude_md, principle, persona, playbook, doc, cluster, promotion, educated-bet, pain-point-cluster, theme}`.

Follow-up: treat constraint-drift as a first-class concern. Any migration that touches `reference_docs_kind_check` should query `pg_constraint` first rather than hand-listing. Consider lifting the kind vocabulary into a small companion table (`reference_docs_kinds`) with a foreign key, so a migration adding a new kind is an INSERT rather than a constraint swap.

## 6. Tuning notes

- Default `top_n=10` + seed-pool multiplier 5 = 50 seeds. For sparsely-distributed vectors that's plenty; for highly dense corpora (lots of near-duplicates across the window) the real top density rows swamp out modest-density clusters. The verification had to use `top_n=50` in the seeded positive-path test to surface a 3-row synthetic cluster — real organic operation with `top_n=10` is fine because it's _selecting_ the most emergent clusters, not enumerating them all.
- `similarity_threshold=0.78` is a first guess from the parent split plan. The scan is monotonic in threshold; tune after a few real weekly runs.
- Baseline is intentionally random-sampled, not comprehensive — 1000 rows is enough for the denominator, avoids O(N·M) blowup on large historical corpora.

## 7. Sequencing

Next in W6.2 split: **W6.2d** (dashboard surface) before **W6.2b** (connections) per the parent plan — because the dashboard immediately makes the data inspectable. W6.2c (LLM synthesis) last.
