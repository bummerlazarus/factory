# W6.2 Research-Director Skill — Split Plan

**Date:** 2026-04-17
**Status:** Plan. Splits L-sized W6.2 into 4 shippable sub-epics (M + S + M + M).
**Author:** Plan subagent; persisted on main thread.

---

## 1. Scope recap

W6.2 is a weekly cross-corpus scan over Edmund's shipped corpora (`memory` namespaces `knowledge`/`content`/`conversations`, plus `work_log`, `observations`, `signals`, `content_metrics_unified`, `reference_docs` kind=`cluster`). It produces three surfaces:

- **Emergent themes** — topics getting denser lately
- **Cross-silo connections** — a captured note overlapping a podcast takeaway overlapping a Beehiiv winner
- **IP-map gaps** — frameworks Edmund hints at but hasn't authored (fed into W6.3)

Output lands as `reference_docs` proposals Edmund can triage from an inbox surface. Feynman is the likely caller (per today's scope reassignment); the Skill itself is a scheduled SQL-function + Edge-Function pair matching the Librarian / Double-down / Educated-bets pattern.

## 2. Dependency map

**Shipped (consumable today):**
- `public.memory` (1536-dim pgvector, namespaces, (source, source_id) idempotency) — W1.1
- `public.observations` + `public.reference_docs` (kind CHECK extended through `cluster`, `promotion`, `educated-bet`) — W0.2, W5.8, W5.9
- `public.librarian_cluster_observations(int)` → `reference_docs` kind=`cluster` — W6.1
- `public.content_metrics_unified` view — W5.7
- `public.signals` + `signal_source_health` — W4.5
- `capture()` / `youtube-ingest` / `signals-ingest` Edge Functions (all write memory with source + source_id) — W2.1, W4.4, W4.5
- Two-phase SQL+Edge pattern proven by W4.4, recommended by W5.8 header
- `pg_cron` installed — W6.1
- `/inbox/promotions` route exists; no `/inbox/research` yet

**Pending but NOT blocking:**
- Nothing writes `observations` rows today (W6.1 follow-up). Observation producer (in flight) fills this gap. Scans can still work off `memory` + `signals` + `content_metrics` until then.

**Downstream consumers:**
- W6.3 IP map needs stable themes from W6.2a + classification against authored `reference_docs` kinds
- W6.4 pain-points Skill reuses similar cross-corpus scan infrastructure

## 3. Split into sub-epics

### W6.2a — Emergent-theme SQL scan (M)

`research_director_themes(window_days, baseline_days, top_n, similarity_threshold)` Postgres function unions memory/observations/signals embeddings, cross-references window density vs rolling baseline, clusters, writes `reference_docs` kind=`theme`.

**Acceptance:**
1. Zero-data run returns cleanly
2. Seeded-data run produces ≥1 theme spanning ≥2 distinct `memory.source` values
3. Idempotent on slug `theme-<YYYY-MM-DD>-<hash>`
4. pg_cron `research-director-weekly` scheduled Mondays 07:00 UTC
5. `reference_docs.kind` CHECK extended to include `theme` additively

**Depends on:** W6.1 shipped, `memory` populated (✓ today)

### W6.2b — Cross-silo connections SQL scan (S)

`research_director_connections(window_days, top_n)` finds high-similarity pairs where members come from DIFFERENT `memory.source` values. Writes `reference_docs` kind=`connection`.

**Acceptance:**
1. Zero-data clean
2. One `connection` row per cross-source pair above 0.80 similarity, capped at top_n
3. Body: "A (source=X) ↔ B (source=Y): <similarity>" with 200-char snippets
4. Idempotent on `connection-<YYYY-MM-DD>-<pair_hash>`
5. Scheduled as second call inside `research-director-weekly`

**Depends on:** W6.2a

### W6.2c — Synthesis Edge Function (M)

`research-director-synthesize` Edge Function reads unresolved `reference_docs` kind ∈ {theme, connection} from last 7 days, calls OpenAI to rewrite the crude SQL-generated title + body into a readable proposal. Two-phase pattern from W4.4.

**Acceptance:**
1. Deploys with `verify_jwt=false`
2. POST with no body reprocesses all last-7-day theme/connection rows lacking `metadata.synthesized_at`
3. POST `{ids:[...]}` targets specific rows
4. Missing `OPENAI_API_KEY` → 200 + `warnings:["synthesis-skipped-no-openai"]`, raw body preserved
5. Writes `metadata.synthesized_at`, bumps `reference_docs.version`
6. Idempotent — reprocessing is a no-op unless `force:true`
7. Chained in the pg_cron job OR separate 15-min-later cron

**Depends on:** W6.2a + W6.2b

### W6.2d — /inbox/research dashboard surface (M)

Server component listing `reference_docs` where `kind IN ('theme','connection')` in last 30 days. Member-count + source-breakdown badges. Open + Approve/Dismiss actions writing `metadata.approved_at` / `metadata.dismissed_at`. Sidebar link.

**Acceptance:**
1. `/inbox/research` returns HTTP 200 with server-rendered theme/connection list
2. Source-breakdown badge shows distinct `memory.source` values per item
3. Approve/Dismiss round-trips through `/api/research/decide`
4. Sidebar link visible
5. Empty-state when no rows

**Depends on:** W6.2a (+ W6.2b nice-to-have, W6.2c optional polish)

## 4. Suggested sequence

1. **W6.2a** — foundation; produces inspectable data via SQL
2. **W6.2d** — first user-visible value in the dashboard
3. **W6.2b** — add connections; dashboard surface already renders them (same query)
4. **W6.2c** — synthesis polish once enough raw rows justify cost

Each ship delivers user-visible value by step 2. No work sits idle.

## 5. Open questions for Edmund

1. **`/inbox/research` as new tab** vs folding into `/inbox/promotions`? (Recommend new tab — "promotions" already means content-promotions.)
2. **Themes as `reference_docs` with new kind** (matches W8.1 specialist-spawn doc precedent) vs dedicated `research_proposals` table? (Recommend `reference_docs`.)
3. **Similarity thresholds** — accept 0.78 for themes, 0.80 for connections as first guesses?
4. **Synthesis spend** — OK to auto-call OpenAI ~20×/week from W6.2c without per-run approval? (~pennies at gpt-4o-mini rates.)
5. **Caller identity** — Feynman-orchestrated (weekly kick-off via chat) or pure pg_cron autonomous? (Recommend pg_cron autonomous; Feynman reads results.)

## 6. W6.2a — concrete acceptance criteria (ready-to-dispatch)

**Migration file:** `dashboard/supabase/migrations/20260417120000_research_director_themes.sql`

**Preconditions verified:**
- `memory` has rows across ≥2 namespaces (currently true — 13,192 rows)
- `pg_cron` installed (W6.1)
- `reference_docs.kind` CHECK currently allows `{goal,value,kpi,framework,claude_md,principle,persona,playbook,doc,cluster,promotion,educated-bet}`; extend to add `theme`

**Function signature:**
```sql
public.research_director_themes(
  window_days integer DEFAULT 7,
  baseline_days integer DEFAULT 90,
  top_n integer DEFAULT 10,
  similarity_threshold double precision DEFAULT 0.78
) RETURNS jsonb
```

**Algorithm (SQL-only, no LLM):**
1. Pull `memory` rows in window (`namespace IN ('knowledge','content','conversations')`, `embedding IS NOT NULL`). Cap 1000 most recent.
2. Random-sample 1000 baseline rows from (window_end - baseline_days).
3. Per window row: `sim_to_window` + `sim_to_baseline` via pgvector `<=>`.
4. Density = `sim_to_window / GREATEST(sim_to_baseline, 1)`. Rank descending.
5. Connected-components clustering (W6.1 recursive CTE pattern) on top-ranked rows. Drop singletons.
6. Exemplar = highest density; tiebreak newest.
7. One `reference_docs` kind=`theme` row per cluster.

**Row shape:**
- `slug = 'theme-<YYYY-MM-DD>-<md5(exemplar_id)[0:8]>'`
- `title = 'Theme ' || window_end_date || ' — ' || left(exemplar.content, 80)`
- `body`: header + 200-char snippets tagged `(source=..., namespace=...)`
- `metadata`: `window_start/end`, `baseline_start/end`, `cluster_size`, `member_memory_ids[]`, `member_sources[]` distinct, `member_namespaces[]`, `exemplar_memory_id`, `density_score`, `similarity_threshold`, `generator`, `generated_at`

**Idempotency:** `INSERT ... ON CONFLICT (slug) DO UPDATE SET title, body, metadata, version = version+1`.

**Zero-data:** Return `{processed:0, themes_written:0, note:"..."}`.

**Bounded cost:** window cap 1000, baseline 1000, pairwise `a.id < b.id` + similarity threshold (HNSW index `idx_memory_embedding_hnsw` exists).

**Schedule:**
```sql
SELECT cron.schedule(
  'research-director-weekly',
  '0 7 * * 1',
  $$ SELECT public.research_director_themes(7, 90, 10, 0.78); $$
);
```

**Acceptance checks:**
1. Zero-data: `{processed:0, themes_written:0, note:"..."}`
2. Seed 5 memory rows (3 near-duplicate across namespaces + 2 unrelated) → `processed:5, themes_written:1`
3. SELECT: theme row with `cluster_size=3`, ≥2 distinct `member_sources`
4. Re-run: version bumps, no duplicate slug
5. `cron.job` has `research-director-weekly` at 07:00 Monday
6. Cleanup seeds

**Rollback documented in migration header.**

---

## Critical files for reference

- `dashboard/supabase/migrations/20260417060000_librarian_cluster.sql` — recursive-CTE clustering pattern
- `dashboard/supabase/migrations/20260417080000_double_down_skill.sql` — Skill + cron pattern
- `dashboard/supabase/migrations/20260417050000_content_metrics_unified_view.sql` — view style
- Phase-2 memory migration — embedding column + HNSW index
- `dashboard/app/inbox/page.tsx` — inbox surface pattern for W6.2d
