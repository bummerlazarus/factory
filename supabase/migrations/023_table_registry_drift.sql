-- 023_table_registry_drift.sql
-- Drift detection for table_registry.
-- View: surfaces tables in the live DB that aren't in registry, and registry
--   rows whose target table no longer exists.
-- Function: register_unclassified_tables() inserts missing tables with safe
--   defaults (unknown/unclassified/safe_for_default_retrieval=false) so the
--   routing layer knows about them immediately. Humans then re-classify.
--
-- Applied to obizmgugsqirmnjpirnh on 2026-05-03.

-- Drift surface.
CREATE OR REPLACE VIEW public.table_registry_drift AS
WITH live AS (
  SELECT c.relname AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r','v','m','p')
)
SELECT
  COALESCE(live.table_name, reg.table_name) AS table_name,
  CASE
    WHEN live.table_name IS NULL THEN 'registry_orphan'
    WHEN reg.table_name  IS NULL THEN 'missing_from_registry'
  END AS drift
FROM live
FULL OUTER JOIN public.table_registry reg
  ON reg.table_name = live.table_name
WHERE live.table_name IS NULL OR reg.table_name IS NULL
ORDER BY drift, table_name;

COMMENT ON VIEW public.table_registry_drift IS
  'Diff between live public-schema tables and table_registry. registry_orphan = registry row points at a missing table; missing_from_registry = live table not yet classified. Source: migration 023.';

-- Auto-stub function. Inserts safe defaults for any unregistered live table.
-- Returns the count inserted. Callers (a scheduled task or post-migration
-- hook) can run this and then a human re-classifies via UPDATE.
CREATE OR REPLACE FUNCTION public.register_unclassified_tables()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH inserted AS (
    INSERT INTO public.table_registry (
      table_name, domain, layer, purpose, canonical_status,
      safe_for_default_retrieval, query_style, retrieval_notes, owner_intent
    )
    SELECT
      d.table_name,
      'unclassified',
      'unknown',
      'Auto-registered by register_unclassified_tables(). Reclassify.',
      'unknown',
      false,
      'none',
      'Auto-stub — needs human classification.',
      NULL
    FROM public.table_registry_drift d
    WHERE d.drift = 'missing_from_registry'
    ON CONFLICT (table_name) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.register_unclassified_tables IS
  'Insert safe-default table_registry rows for any live public table not yet registered. Run periodically or after migrations. Reclassify auto-stubs (canonical_status=unknown, domain=unclassified) via UPDATE.';

-- Register the new objects.
INSERT INTO public.table_registry (table_name, domain, layer, purpose, canonical_status, safe_for_default_retrieval, query_style, retrieval_notes, owner_intent) VALUES
  ('table_registry_drift','meta','metric',
    'Drift between live public tables and table_registry (view).',
    'canonical', false, 'sql',
    'Run weekly or after migrations. Surface for human triage.', NULL)
ON CONFLICT (table_name) DO UPDATE SET
  purpose = EXCLUDED.purpose,
  retrieval_notes = EXCLUDED.retrieval_notes,
  last_audited_at = now();
