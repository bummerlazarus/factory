-- Migration 010 — 2026-04-17
-- Phase 1: Rich data capture — link agent_messages to sessions
--
-- Purpose:
--   The audit flagged (#5) that `agent_messages` is a flat append-only log with no way to
--   retrieve a conversation thread. With `sessions` now live (migration 005), we can
--   group messages into sessions.
--
--   Scope of THIS migration: add the column + index + FK. NOT-NULL is NOT enforced yet —
--   the 354 existing rows have no session, and we don't want to invent fake sessions
--   just to satisfy a constraint. New writes via the capture Edge Function will always
--   set session_id.
--
--   A later migration (Phase 5 — schema hardening, per data-model.md) can:
--     - backfill a synthetic "legacy" session for existing rows
--     - flip to NOT NULL
--     - also migrate the bigint id PK to uuid (separate concern, called out in audit #5)
--
-- Changes:
--   1. ADD COLUMN session_id uuid NULL
--   2. ADD FK to sessions(id) ON DELETE SET NULL
--   3. ADD INDEX (session_id, created_at DESC) — the thread-read query pattern
--
-- Verification:
--   \d public.agent_messages
--   -- expect new column session_id uuid, FK to public.sessions(id)
--   SELECT indexname FROM pg_indexes WHERE tablename = 'agent_messages';
--   -- expect idx_agent_messages_session_created
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_agent_messages_session_created;
--   ALTER TABLE public.agent_messages DROP CONSTRAINT IF EXISTS agent_messages_session_id_fkey;
--   ALTER TABLE public.agent_messages DROP COLUMN IF EXISTS session_id;

ALTER TABLE public.agent_messages
    ADD COLUMN IF NOT EXISTS session_id uuid;

ALTER TABLE public.agent_messages
    ADD CONSTRAINT agent_messages_session_id_fkey
    FOREIGN KEY (session_id)
    REFERENCES public.sessions(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_messages_session_created
    ON public.agent_messages (session_id, created_at DESC);

COMMENT ON COLUMN public.agent_messages.session_id IS 'FK to sessions. Nullable for legacy rows; new writes via capture() always set this.';
