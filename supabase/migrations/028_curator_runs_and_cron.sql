-- Phase 2 — Curator nudges.
-- curator_runs: append-only log of every curator_pass invocation.
-- pg_cron job: nightly 8am UTC (3am Central) calls curator_pass via pg_net.
--
-- Applied via Supabase MCP on 2026-05-03; this file is the canonical record.
--
-- Rollback:
--   SELECT cron.unschedule('curator-pass-nightly');
--   DROP TABLE IF EXISTS public.curator_runs;

CREATE TABLE IF NOT EXISTS public.curator_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL CHECK (status IN ('running','ok','error')),
  lookback_hours  integer,
  items_examined  integer,
  proposals_written integer,
  notes           text,
  error_message   text
);

CREATE INDEX IF NOT EXISTS curator_runs_started_idx ON public.curator_runs (started_at DESC);

-- Schedule the nightly run. Reads CAPTURE_SECRET from Vault.
DO $$
DECLARE
  capture_secret text;
  fn_url text;
BEGIN
  SELECT decrypted_secret INTO capture_secret FROM vault.decrypted_secrets WHERE name = 'CAPTURE_SECRET' LIMIT 1;
  IF capture_secret IS NULL THEN
    RAISE NOTICE 'CAPTURE_SECRET not in Vault — cron will need a manual update once secret is added.';
    capture_secret := '__SET_ME__';
  END IF;

  fn_url := 'https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/curator_pass';

  PERFORM cron.unschedule('curator-pass-nightly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'curator-pass-nightly');

  PERFORM cron.schedule(
    'curator-pass-nightly',
    '0 8 * * *',  -- 8am UTC = 3am Central
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('content-type','application/json','x-capture-secret', %L),
        body := jsonb_build_object('hours', 24)::text
      );
    $cron$, fn_url, capture_secret)
  );
END$$;
