-- Migration 017 — ingest_runs visibility table
-- Applied: 2026-04-24 on obizmgugsqirmnjpirnh
--
-- Purpose: every ingest pipeline (YouTube, article, PDF, transcript) writes a row
-- here so failures are debuggable in seconds instead of hours. Closes the
-- visibility gap that produced the 8-hour YouTube ingest rabbit hole on 2026-04-24.
--
-- Lifecycle:
--   1. Pipeline INSERTs a 'running' row at start, gets back the id.
--   2. On success: UPDATE status='succeeded', finished_at, items_processed.
--   3. On failure: UPDATE status='failed', finished_at, error_message.
--
-- Convention: every ingest script (ops/bin/*) MUST write to this table.
-- See ops/bin/ingest-youtube.sh for the canonical pattern.
--
-- Verification:
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public' AND table_name='ingest_runs';
--   -- expects: 1
--
--   SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='ingest_runs';
--   -- expects: ingest_runs_anon_select (SELECT, {anon})
--
-- Rollback:
--   DROP TABLE IF EXISTS public.ingest_runs;

CREATE TABLE IF NOT EXISTS public.ingest_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type     text NOT NULL CHECK (source_type IN ('youtube','article','pdf','transcript','other')),
    source_url      text,
    source_title    text,
    status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    items_processed int,
    items_failed    int,
    error_message   text,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    tags            text[] NOT NULL DEFAULT ARRAY[]::text[]
);

CREATE INDEX IF NOT EXISTS ingest_runs_started_at_idx
    ON public.ingest_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS ingest_runs_status_started_idx
    ON public.ingest_runs (status, started_at DESC);

ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;

-- Single-user project (Edmund). Anon SELECT is fine — same threat model
-- as work_log (migration 016). Revisit if multi-tenant.
DROP POLICY IF EXISTS ingest_runs_anon_select ON public.ingest_runs;
CREATE POLICY ingest_runs_anon_select
    ON public.ingest_runs
    FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS ingest_runs_authenticated_select ON public.ingest_runs;
CREATE POLICY ingest_runs_authenticated_select
    ON public.ingest_runs
    FOR SELECT
    TO authenticated
    USING (true);

-- service_role bypasses RLS by default, so writes from the ingest scripts
-- (which use SUPABASE_SERVICE_ROLE_KEY) work without an explicit insert policy.
