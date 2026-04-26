-- Migration 004 — 2026-04-17
-- Phase 0.5: Security fixes
--
-- Problem:
--   Table `agent_scratchpad` has RLS disabled. Same concern as agent_conversations —
--   if the anon key leaks, scratchpad contents (tied to personas/conversations) are readable.
--
-- Fix:
--   Enable RLS. Service_role bypasses; anon/authenticated denied by default.
--
-- Verification:
--   SELECT relrowsecurity FROM pg_class
--     JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
--     WHERE pg_namespace.nspname = 'public' AND pg_class.relname = 'agent_scratchpad';
--   -- expected: true
--
-- Rollback:
--   ALTER TABLE public.agent_scratchpad DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_scratchpad ENABLE ROW LEVEL SECURITY;
