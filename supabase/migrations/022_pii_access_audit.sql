-- 022_pii_access_audit.sql
-- PII access observability (Option B from supabase/proposals/pii-default-deny-rls.md).
-- Creates pii_access_log + auto-trigger writes/deletes on the 11 PII tables
-- + a voluntary log_pii_read() helper for SELECT auditing (vanilla Postgres
-- has no SELECT triggers; helper is the honest ceiling for queryable audit).
--
-- Applied to obizmgugsqirmnjpirnh on 2026-05-03.

CREATE TABLE IF NOT EXISTS public.pii_access_log (
  id           bigserial PRIMARY KEY,
  table_name   text NOT NULL,
  action       text NOT NULL CHECK (action IN ('read','insert','update','delete')),
  db_role      text NOT NULL DEFAULT current_user,
  caller       text,
  intent       text,
  row_count    integer,
  context      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pii_access_log_table_time
  ON public.pii_access_log (table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pii_access_log_action_time
  ON public.pii_access_log (action, created_at DESC);

ALTER TABLE public.pii_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON public.pii_access_log;
CREATE POLICY service_role_all ON public.pii_access_log FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.pii_access_log IS
  'Audit trail for PII table access. Writes/deletes auto-logged by triggers; reads voluntarily logged by callers via log_pii_read(). Source: migration 022.';

-- Voluntary read-logger. New Edge Functions reading PII should call this.
CREATE OR REPLACE FUNCTION public.log_pii_read(
  p_table   text,
  p_intent  text,
  p_rows    integer DEFAULT NULL,
  p_caller  text DEFAULT NULL,
  p_context jsonb DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.pii_access_log (table_name, action, caller, intent, row_count, context)
  VALUES (p_table, 'read', p_caller, p_intent, p_rows, p_context)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_pii_read IS
  'Voluntary read-audit helper. Edge Functions reading PII should call this with intent + row count.';

-- DML auto-logger trigger function.
CREATE OR REPLACE FUNCTION public._pii_dml_audit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pii_access_log (table_name, action, db_role, row_count)
  VALUES (TG_TABLE_NAME, lower(TG_OP), current_user, 1);
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach triggers to all 11 PII tables.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'clients','profiles','contact_submissions','lead_magnet_submissions',
    'waitlist','scorecard_responses','assessment_results',
    'rhythm_plans','rhythm_activities','invoices','invoice_items'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS pii_dml_audit ON public.%I;', t
    );
    EXECUTE format(
      'CREATE TRIGGER pii_dml_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public._pii_dml_audit();', t
    );
  END LOOP;
END $$;

-- Recent-activity convenience view.
CREATE OR REPLACE VIEW public.pii_access_recent AS
SELECT id, created_at, table_name, action, db_role, caller, intent, row_count, context
FROM public.pii_access_log
ORDER BY created_at DESC
LIMIT 200;

COMMENT ON VIEW public.pii_access_recent IS
  'Last 200 PII access events. Dashboard-friendly snapshot.';

-- Register the new objects in table_registry.
INSERT INTO public.table_registry (table_name, domain, layer, purpose, canonical_status, safe_for_default_retrieval, query_style, retrieval_notes, owner_intent) VALUES
  ('pii_access_log','meta','log',
    'Audit trail for PII table access (writes auto, reads voluntary).',
    'canonical', false, 'sql',
    'Internal observability. Read via pii_access_recent view.', NULL),
  ('pii_access_recent','meta','log',
    'Last 200 PII access events (view over pii_access_log).',
    'canonical', false, 'sql',
    'Dashboard surface for PII observability.', NULL)
ON CONFLICT (table_name) DO UPDATE SET
  purpose = EXCLUDED.purpose,
  retrieval_notes = EXCLUDED.retrieval_notes,
  last_audited_at = now();
