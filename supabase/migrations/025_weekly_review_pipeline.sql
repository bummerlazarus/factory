-- 025_weekly_review_pipeline.sql
-- Pure-SQL weekly review pipeline. Replaces the planned remote-Claude-agent
-- approach (claude.ai connector friction). pg_cron runs run_weekly_review()
-- weekly; results land in weekly_review for dashboard / Claude-Code session
-- review.
--
-- Three checks rolled into one summary row:
--   1. drift          — anything in table_registry_unclassified
--   2. router_health  — anything in router_improvement_candidates
--   3. pii_audit      — last-7d activity summary from pii_access_log
--
-- Applied to obizmgugsqirmnjpirnh on 2026-05-03.

CREATE TABLE IF NOT EXISTS public.weekly_review (
  id              bigserial PRIMARY KEY,
  reviewed_at     timestamptz NOT NULL DEFAULT now(),
  drift           jsonb NOT NULL,
  router_health   jsonb NOT NULL,
  pii_audit       jsonb NOT NULL,
  attention_needed boolean NOT NULL DEFAULT false,
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_weekly_review_reviewed_at
  ON public.weekly_review (reviewed_at DESC);

ALTER TABLE public.weekly_review ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON public.weekly_review;
CREATE POLICY service_role_all ON public.weekly_review FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.weekly_review IS
  'Weekly snapshot of routing-layer health: drift, router feedback, PII audit. One row per run. attention_needed=true means at least one section has new things to triage.';

CREATE OR REPLACE FUNCTION public.run_weekly_review()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_drift          jsonb;
  v_router         jsonb;
  v_pii            jsonb;
  v_attention      boolean := false;
  v_id             bigint;
BEGIN
  -- 1. Drift: tables auto-stubbed and waiting for human classification.
  SELECT COALESCE(jsonb_build_object(
    'count', count(*),
    'tables', COALESCE(jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'last_audited_at', last_audited_at,
      'retrieval_notes', retrieval_notes
    ) ORDER BY last_audited_at DESC), '[]'::jsonb)
  ), jsonb_build_object('count', 0, 'tables', '[]'::jsonb))
  INTO v_drift
  FROM public.table_registry_unclassified;

  -- 2. Router health: namespaces flagged as demote_candidate / review_candidate.
  SELECT COALESCE(jsonb_build_object(
    'count', count(*),
    'namespaces', COALESCE(jsonb_agg(jsonb_build_object(
      'namespace', namespace,
      'samples_total', samples_total,
      'useful_ratio', useful_ratio,
      'recommendation', recommendation
    ) ORDER BY useful_ratio ASC), '[]'::jsonb)
  ), jsonb_build_object('count', 0, 'namespaces', '[]'::jsonb))
  INTO v_router
  FROM public.router_improvement_candidates;

  -- 3. PII audit: 7d rollup of access events.
  SELECT COALESCE(jsonb_build_object(
    'window_days', 7,
    'events_total', count(*),
    'by_table', COALESCE(jsonb_object_agg(table_name, action_counts), '{}'::jsonb)
  ), jsonb_build_object('window_days', 7, 'events_total', 0, 'by_table', '{}'::jsonb))
  INTO v_pii
  FROM (
    SELECT
      table_name,
      jsonb_object_agg(action, n) AS action_counts,
      sum(n) AS table_total
    FROM (
      SELECT table_name, action, count(*) AS n
      FROM public.pii_access_log
      WHERE created_at >= now() - interval '7 days'
      GROUP BY table_name, action
    ) per_action
    GROUP BY table_name
  ) per_table;

  v_attention := (v_drift->>'count')::int > 0
              OR (v_router->>'count')::int > 0
              OR (v_pii->>'events_total')::int > 0;

  INSERT INTO public.weekly_review (drift, router_health, pii_audit, attention_needed)
  VALUES (v_drift, v_router, v_pii, v_attention)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.run_weekly_review IS
  'Roll up drift / router-health / PII-audit into one weekly_review row. Called by pg_cron weekly; safe to run on demand.';

CREATE OR REPLACE VIEW public.weekly_review_latest AS
SELECT * FROM public.weekly_review ORDER BY reviewed_at DESC LIMIT 1;

CREATE OR REPLACE VIEW public.weekly_review_attention AS
SELECT * FROM public.weekly_review WHERE attention_needed ORDER BY reviewed_at DESC LIMIT 10;

COMMENT ON VIEW public.weekly_review_latest IS 'Most recent weekly_review row.';
COMMENT ON VIEW public.weekly_review_attention IS 'Last 10 weekly_review rows that flagged attention_needed.';

-- Schedule: every Monday at 13:30 UTC (8:30am ET, 30 min after the drift cron).
DO $$
BEGIN
  PERFORM cron.unschedule('weekly_review')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly_review');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'weekly_review',
  '30 13 * * 1',
  $$SELECT public.run_weekly_review();$$
);

INSERT INTO public.table_registry (table_name, domain, layer, purpose, canonical_status, safe_for_default_retrieval, query_style, retrieval_notes, owner_intent) VALUES
  ('weekly_review','meta','log','Weekly snapshot of routing-layer health.','canonical', false, 'sql','Read via weekly_review_latest / weekly_review_attention.', NULL),
  ('weekly_review_latest','meta','metric','Most recent weekly_review row (view).','canonical', false, 'sql','Quick check.', NULL),
  ('weekly_review_attention','meta','metric','Last 10 weekly_review rows flagging attention_needed (view).','canonical', false, 'sql','Triage queue for Edmund.', NULL)
ON CONFLICT (table_name) DO UPDATE SET
  purpose = EXCLUDED.purpose,
  retrieval_notes = EXCLUDED.retrieval_notes,
  last_audited_at = now();
