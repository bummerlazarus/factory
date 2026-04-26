-- Migration 006 — 2026-04-17
-- Phase 1: Rich data capture — work_log
--
-- Purpose:
--   Answers the proactive-surfacing question "what did I push forward today?" (pillar 5).
--   Agents write to this table at the end of a session, after merging a PR, after a
--   Notion update, after a Skill promotion — anywhere a unit of progress happens.
--
--   Distinct from `scheduled_tasks` / `agent_scheduled_tasks` (intent / plan) — this is
--   the write-side "what actually happened" log.
--
-- Columns:
--   id          uuid pk
--   session_id  uuid fk → sessions(id) on delete set null
--                (nullable: some writes happen outside a session, e.g. scheduled task)
--   project     text — free-text project tag (e.g. "zpm", "real+true", "cordial-catholics",
--                "dc-podcast", "factory", "client:cfcs"). Matches sessions.app convention.
--   kind        text enum-check — type of progress
--   summary     text — one-to-three sentences, agent-written
--   artifacts   jsonb — references to produced artifacts:
--                [{ kind: "notion_page", id: "...", url: "..." },
--                 { kind: "pr", repo: "...", number: 42 },
--                 { kind: "file", path: "..." }]
--   created_at  timestamptz default now()
--
-- RLS: enabled. authenticated SELECT, service_role writes.
--
-- Verification:
--   SELECT count(*) FROM public.work_log; -- 0
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'work_log'; -- true
--
-- Rollback:
--   DROP TABLE IF EXISTS public.work_log CASCADE;

CREATE TABLE IF NOT EXISTS public.work_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
    project     text,
    kind        text NOT NULL DEFAULT 'note'
                 CHECK (kind IN (
                     'decision',
                     'shipped',
                     'published',
                     'research',
                     'draft',
                     'note',
                     'blocker_cleared',
                     'meeting',
                     'retro'
                 )),
    summary     text NOT NULL,
    artifacts   jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.work_log IS 'Agent-written "what got pushed forward" log. Source for the daily recap + last-touched-per-project surfaces.';
COMMENT ON COLUMN public.work_log.kind IS 'Coarse category for filtering the recap UI. Add values via ALTER TABLE if a new surface emerges.';
COMMENT ON COLUMN public.work_log.artifacts IS 'JSONB array of produced artifacts. Shape: [{kind, id?, url?, path?, ...}]. Queryable via GIN index.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_work_log_session_id       ON public.work_log (session_id);
CREATE INDEX IF NOT EXISTS idx_work_log_project          ON public.work_log (project);
CREATE INDEX IF NOT EXISTS idx_work_log_kind             ON public.work_log (kind);
CREATE INDEX IF NOT EXISTS idx_work_log_created_at_desc  ON public.work_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_log_artifacts_gin    ON public.work_log USING GIN (artifacts);

-- RLS
ALTER TABLE public.work_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY work_log_authenticated_select
    ON public.work_log
    FOR SELECT
    TO authenticated
    USING (true);
