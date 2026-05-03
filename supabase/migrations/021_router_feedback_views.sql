-- 021_router_feedback_views.sql
-- Self-improvement layer for the routing infra (migration 020).
-- Aggregates public.agent_retrieval_feedback into views the router and
-- humans can read. NO auto-mutation of intent_router / table_registry —
-- the views surface signal; promotion stays human-in-loop.
--
-- Applied to obizmgugsqirmnjpirnh on 2026-05-03.

-- Per-namespace usefulness rollup (lifetime + 30d).
CREATE OR REPLACE VIEW public.router_namespace_health AS
WITH base AS (
  SELECT
    namespace,
    was_useful,
    created_at,
    (created_at >= now() - interval '30 days') AS recent
  FROM public.agent_retrieval_feedback
  WHERE namespace IS NOT NULL
)
SELECT
  namespace,
  count(*)                                  AS samples_total,
  sum(CASE WHEN was_useful THEN 1 ELSE 0 END)::int AS useful_total,
  round(
    sum(CASE WHEN was_useful THEN 1 ELSE 0 END)::numeric
      / NULLIF(count(*), 0), 3
  )                                         AS useful_ratio,
  count(*) FILTER (WHERE recent)            AS samples_30d,
  sum(CASE WHEN recent AND was_useful THEN 1 ELSE 0 END)::int AS useful_30d,
  round(
    sum(CASE WHEN recent AND was_useful THEN 1 ELSE 0 END)::numeric
      / NULLIF(count(*) FILTER (WHERE recent), 0), 3
  )                                         AS useful_ratio_30d,
  max(created_at)                           AS last_feedback_at
FROM base
GROUP BY namespace
ORDER BY samples_total DESC;

COMMENT ON VIEW public.router_namespace_health IS
  'Per-namespace usefulness rollup of agent_retrieval_feedback. Read by humans / dashboards reviewing whether memory_lookup namespace defaults still make sense. Source: migration 021.';

-- Candidates for router-improvement review.
-- Flags namespaces with a meaningful sample size AND low useful ratio.
-- Thresholds are intentionally conservative: low samples = needs more data,
-- not penalty.
CREATE OR REPLACE VIEW public.router_improvement_candidates AS
SELECT
  namespace,
  samples_total,
  useful_total,
  useful_ratio,
  CASE
    WHEN samples_total < 5 THEN 'insufficient_data'
    WHEN useful_ratio < 0.3 THEN 'demote_candidate'
    WHEN useful_ratio < 0.5 THEN 'review_candidate'
    ELSE 'healthy'
  END AS recommendation,
  last_feedback_at
FROM public.router_namespace_health
WHERE samples_total >= 5
  AND useful_ratio < 0.5
ORDER BY useful_ratio ASC, samples_total DESC;

COMMENT ON VIEW public.router_improvement_candidates IS
  'Namespaces flagged for router review. Threshold: ≥5 samples and <50% useful. Self-improvement signal — does NOT auto-mutate intent_router. Source: migration 021.';

-- Promote agent_retrieval_feedback in the registry now that it has a real
-- consumer (these views). No-op if the row was already updated.
UPDATE public.table_registry
SET
  canonical_status = 'canonical',
  retrieval_notes = 'Feedback signal source for router_namespace_health / router_improvement_candidates views (migration 021). Still default-deny for retrieval — internal observability.',
  last_audited_at = now()
WHERE table_name = 'agent_retrieval_feedback';

-- Add the two new views to table_registry too.
INSERT INTO public.table_registry (table_name, domain, layer, purpose, canonical_status, safe_for_default_retrieval, query_style, retrieval_notes, owner_intent) VALUES
  ('router_namespace_health','meta','metric',
    'Per-namespace usefulness rollup from agent_retrieval_feedback (view).',
    'canonical', false, 'sql',
    'Read by humans / dashboards reviewing namespace defaults. Not for general retrieval.',
    NULL),
  ('router_improvement_candidates','meta','metric',
    'Namespaces flagged for router review (≥5 samples, <50% useful) — view.',
    'canonical', false, 'sql',
    'Self-improvement signal. Human-in-loop; no auto-mutation.',
    NULL)
ON CONFLICT (table_name) DO UPDATE SET
  purpose = EXCLUDED.purpose,
  retrieval_notes = EXCLUDED.retrieval_notes,
  last_audited_at = now();
