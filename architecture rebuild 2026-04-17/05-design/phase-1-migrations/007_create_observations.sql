-- Migration 007 — 2026-04-17
-- Phase 1: Rich data capture — observations
--
-- Purpose:
--   The self-improving / recursive-learning loop (pillar 4). Agents flag patterns,
--   repeated preferences, candidate SOPs, contradictions, or frameworks worth promoting
--   to Skills or reference docs. Edmund approves promotions individually.
--
--   Conceptually: "notes the agent wants to remember for later." The end-of-session retro
--   ("Based on this conversation, I can update these things — approve?") writes to this
--   table. `approved_at` gates the promotion; `promoted_to_skill_id` records where it
--   landed when promoted to a Skill version.
--
-- Columns:
--   id                    uuid pk
--   session_id            uuid fk → sessions(id) on delete set null
--   kind                  text enum — what type of observation
--   body                  text — the observation itself
--   confidence            numeric(3,2) — 0.00 to 1.00, agent's own confidence
--   approved_at           timestamptz — when Edmund approved (null = pending)
--   promoted_to_skill_id  uuid fk → skill_versions(id) — where it landed (nullable)
--   metadata              jsonb — references (source messages, related docs, links)
--   created_at            timestamptz default now()
--
-- RLS: enabled. authenticated SELECT + UPDATE (approve), service_role full access.
--
-- Verification:
--   SELECT count(*) FROM public.observations; -- 0
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'observations'; -- true
--
-- Rollback:
--   DROP TABLE IF EXISTS public.observations CASCADE;
--
-- Dependency note: this migration references public.skill_versions via FK. Apply 008
-- BEFORE 007, or apply 007 without the FK and add it after 008. Chosen ordering in this
-- file: apply 008 first (see README). If you run this in numeric order, the FK line
-- will fail — see the README for the corrected order.

CREATE TABLE IF NOT EXISTS public.observations (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id            uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
    kind                  text NOT NULL DEFAULT 'pattern'
                           CHECK (kind IN (
                               'pattern',
                               'preference',
                               'candidate_skill',
                               'candidate_doc_update',
                               'contradiction',
                               'framework',
                               'todo',
                               'risk'
                           )),
    body                  text NOT NULL,
    confidence            numeric(3,2)
                           CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    approved_at           timestamptz,
    promoted_to_skill_id  uuid REFERENCES public.skill_versions(id) ON DELETE SET NULL,
    metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.observations IS 'Agent-flagged patterns / candidate SOPs / preferences. Edmund approves; approved rows get promoted into skill_versions or reference_docs.';
COMMENT ON COLUMN public.observations.kind IS 'What type of observation. Drives the triage UI in the dashboard.';
COMMENT ON COLUMN public.observations.confidence IS 'Agent self-reported confidence 0.00-1.00. Used to rank the retro queue.';
COMMENT ON COLUMN public.observations.approved_at IS 'When Edmund approved. NULL = pending review.';
COMMENT ON COLUMN public.observations.promoted_to_skill_id IS 'If promoted into a Skill version, FK to skill_versions. Set by the promotion Edge Function.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_observations_session_id      ON public.observations (session_id);
CREATE INDEX IF NOT EXISTS idx_observations_kind            ON public.observations (kind);
CREATE INDEX IF NOT EXISTS idx_observations_created_at_desc ON public.observations (created_at DESC);
-- Partial index for the pending-review queue (the dashboard's primary query):
CREATE INDEX IF NOT EXISTS idx_observations_pending
    ON public.observations (created_at DESC)
    WHERE approved_at IS NULL;

-- RLS
ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY observations_authenticated_select
    ON public.observations
    FOR SELECT
    TO authenticated
    USING (true);

-- Authenticated can approve (set approved_at). Service role still manages promotion.
CREATE POLICY observations_authenticated_update
    ON public.observations
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);
