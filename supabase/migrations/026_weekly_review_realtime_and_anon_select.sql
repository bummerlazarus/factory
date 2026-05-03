-- 026_weekly_review_realtime_and_anon_select.sql
-- Enable Realtime broadcast + anon SELECT on weekly_review so the dashboard
-- tile can subscribe to INSERTs and read the latest row with the anon key.
-- Safe: weekly_review jsonb columns contain table names + counts only, no
-- PII content (the pii_audit field is rolled up by table+action).
--
-- Applied to obizmgugsqirmnjpirnh on 2026-05-03.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='weekly_review'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.weekly_review';
  END IF;
END $$;

DROP POLICY IF EXISTS anon_select_weekly_review ON public.weekly_review;
CREATE POLICY anon_select_weekly_review ON public.weekly_review
  FOR SELECT TO anon USING (true);
