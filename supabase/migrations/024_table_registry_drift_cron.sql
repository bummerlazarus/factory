-- 024_table_registry_drift_cron.sql
-- Weekly pg_cron job that auto-stubs new public tables into table_registry.
-- Auto-stubs land with domain='unclassified' / canonical_status='unknown'
-- — visible via the table_registry_unclassified view.
--
-- Applied to obizmgugsqirmnjpirnh on 2026-05-03.

-- Convenience view: anything still wearing the auto-stub label.
CREATE OR REPLACE VIEW public.table_registry_unclassified AS
SELECT table_name, last_audited_at, retrieval_notes
FROM public.table_registry
WHERE canonical_status = 'unknown' OR domain = 'unclassified'
ORDER BY last_audited_at DESC;

COMMENT ON VIEW public.table_registry_unclassified IS
  'Tables auto-stubbed by register_unclassified_tables() that still need a human-classified domain/layer/safe-flag. Source: migration 024.';

-- Schedule: every Monday 13:00 UTC (8am ET).
-- pg_cron lives in cron schema; jobname is unique per database.
DO $$
BEGIN
  PERFORM cron.unschedule('table_registry_drift_weekly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'table_registry_drift_weekly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'table_registry_drift_weekly',
  '0 13 * * 1',
  $$SELECT public.register_unclassified_tables();$$
);

-- Register the new view too.
INSERT INTO public.table_registry (table_name, domain, layer, purpose, canonical_status, safe_for_default_retrieval, query_style, retrieval_notes, owner_intent) VALUES
  ('table_registry_unclassified','meta','metric',
    'Auto-stubbed tables awaiting human classification (view).',
    'canonical', false, 'sql',
    'Check after the weekly drift cron fires (Mon 13:00 UTC).', NULL)
ON CONFLICT (table_name) DO UPDATE SET
  purpose = EXCLUDED.purpose,
  retrieval_notes = EXCLUDED.retrieval_notes,
  last_audited_at = now();
