-- Migration 016 — dashboard Realtime on work_log
-- Applied: 2026-04-17 as `phase_3_016_work_log_realtime` on obizmgugsqirmnjpirnh
--
-- Purpose: /inbox page subscribes to work_log INSERT events via Supabase Realtime
-- from a browser-side supabase-js client using the anon JWT. Realtime only fires
-- rows the JWT is permitted to SELECT, so we add an anon SELECT policy.
--
-- This project is single-user (Edmund); widening to anon SELECT on work_log is
-- acceptable given the threat model — no multi-tenant data. Revisit if/when
-- the dashboard opens to other users.
--
-- Verification:
--   SELECT count(*) FROM pg_publication_tables
--    WHERE pubname='supabase_realtime' AND tablename='work_log';
--   -- expects: 1
--
--   SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='work_log';
--   -- expects: work_log_anon_select (SELECT, {anon})
--                work_log_authenticated_select (SELECT, {authenticated})
--
-- Rollback:
--   DROP POLICY IF EXISTS work_log_anon_select ON public.work_log;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.work_log;

DROP POLICY IF EXISTS work_log_anon_select ON public.work_log;
CREATE POLICY work_log_anon_select
    ON public.work_log
    FOR SELECT
    TO anon
    USING (true);

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.work_log;
    EXCEPTION
        WHEN duplicate_object THEN
            NULL;
    END;
END;
$$;
