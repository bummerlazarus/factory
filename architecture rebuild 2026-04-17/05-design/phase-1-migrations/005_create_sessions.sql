-- Migration 005 — 2026-04-17
-- Phase 1: Rich data capture — sessions
--
-- Purpose:
--   Pillar 1 of the rebuild vision is "rich data capture first." Today `agent_messages` is
--   a flat bigint-PK log with no session grouping. We cannot answer "what did I work on
--   today?" or "last touched ZPM" without a session envelope.
--
--   `sessions` represents one Claude conversation / agent run across any surface
--   (CEO Desk, Claude desktop, Claude iPhone, Claude Code, Cowork, dashboard, Edge Function).
--   Other Phase 1 tables (work_log, observations) reference it; agent_messages will be
--   backfilled via migration 010.
--
-- Columns:
--   id             uuid, pk
--   started_at     timestamptz — when the session opened
--   ended_at       timestamptz — when the session closed (nullable while active)
--   source         text — where the session originated (enum-check below)
--   app            text — free-text app/project name (e.g. "ceo-desk", "zpm", "cordial-catholics")
--                        — kept free-text because new Claude projects appear constantly
--   title          text — short human title, agent-written
--   summary        text — post-session retro summary, agent-written
--   token_usage    jsonb — { prompt, completion, total, cost_usd, per_model: {...} }
--   metadata       jsonb — catch-all (device, claude_model, git_branch, etc.)
--   created_at     timestamptz default now()
--   updated_at     timestamptz default now()
--
-- RLS: enabled. service_role bypasses (inserts/updates from Edge Functions); authenticated
-- users can SELECT their own data (Edmund is the only authenticated user; if multi-tenant
-- later, add a user_id fk and tighten).
--
-- Verification:
--   SELECT count(*) FROM public.sessions; -- 0
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'sessions'; -- true
--
-- Rollback:
--   DROP TABLE IF EXISTS public.sessions CASCADE;

CREATE TABLE IF NOT EXISTS public.sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at   timestamptz NOT NULL DEFAULT now(),
    ended_at     timestamptz,
    source       text NOT NULL DEFAULT 'unknown'
                  CHECK (source IN (
                      'ceo_desk',
                      'claude_desktop',
                      'claude_iphone',
                      'claude_code',
                      'claude_cowork',
                      'dashboard',
                      'edge_function',
                      'mcp',
                      'scheduled_task',
                      'unknown'
                  )),
    app          text,
    title        text,
    summary      text,
    token_usage  jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.sessions IS 'One Claude conversation / agent run across any surface. Parent of agent_messages, work_log, observations.';
COMMENT ON COLUMN public.sessions.source IS 'Which surface the session came from. Enum-checked to stay clean; add values via ALTER TABLE if a new surface appears.';
COMMENT ON COLUMN public.sessions.app IS 'Free-text app/project tag (e.g. zpm, ceo-desk, cordial-catholics). Free-text because Claude projects churn.';
COMMENT ON COLUMN public.sessions.token_usage IS 'JSONB — { prompt, completion, total, cost_usd, per_model: {...} }. Rollup of per-message usage.';

-- Indexes (see data-model.md: btree on common query filters + created_at desc)
CREATE INDEX IF NOT EXISTS idx_sessions_started_at_desc ON public.sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_source          ON public.sessions (source);
CREATE INDEX IF NOT EXISTS idx_sessions_app             ON public.sessions (app);
CREATE INDEX IF NOT EXISTS idx_sessions_metadata_gin    ON public.sessions USING GIN (metadata);

-- RLS
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS by default (BYPASSRLS). Add an explicit authenticated SELECT
-- policy so Edmund can read his own history from the dashboard via the authenticated role.
CREATE POLICY sessions_authenticated_select
    ON public.sessions
    FOR SELECT
    TO authenticated
    USING (true);
