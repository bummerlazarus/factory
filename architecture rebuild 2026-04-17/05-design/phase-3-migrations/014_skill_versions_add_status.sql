-- Migration 014 — 2026-04-17
-- Phase 3: Multi-agent loop MVP — skill_versions gets a review lifecycle.
--
-- Purpose:
--   Phase 1 created skill_versions as an audit log where every row was implicitly
--   approved. Phase 3 introduces Corva (end-of-session retro) which DRAFTS proposals.
--   We need a status column + approval metadata so the dashboard /inbox/promotions
--   tab has a clean queue of pending work and so nothing auto-merges (Q7 2026-04-17).
--
--   Status machine:
--     proposed   — drafted by Corva or another agent; needs Edmund's review
--     approved   — Edmund (or seed data) accepted; this is the effective current version
--     rejected   — Edmund turned it down; rejection_reason populated
--     stale      — auto-expired after 14 days unreviewed (not enforced here; future cron)
--
-- Backfill:
--   Every existing row is pre-migration and therefore counts as 'approved'.
--   approved_at defaults to created_at for those rows.
--
-- Index:
--   Partial index on created_at DESC WHERE status='proposed' — matches the dashboard
--   /inbox/promotions query (WHERE status='proposed' ORDER BY created_at DESC).
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_skill_versions_proposed_created_desc;
--   ALTER TABLE public.skill_versions
--     DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS approved_at,
--     DROP COLUMN IF EXISTS approved_by,
--     DROP COLUMN IF EXISTS rejection_reason;

ALTER TABLE public.skill_versions
    ADD COLUMN IF NOT EXISTS status           text        NOT NULL DEFAULT 'approved'
        CHECK (status IN ('proposed', 'approved', 'rejected', 'stale')),
    ADD COLUMN IF NOT EXISTS approved_at      timestamptz,
    ADD COLUMN IF NOT EXISTS approved_by      text,
    ADD COLUMN IF NOT EXISTS rejection_reason text;

COMMENT ON COLUMN public.skill_versions.status           IS 'Review lifecycle: proposed (drafted), approved (effective), rejected (declined), stale (auto-expired after 14d).';
COMMENT ON COLUMN public.skill_versions.approved_at      IS 'When status flipped to approved. Null for proposed/rejected/stale.';
COMMENT ON COLUMN public.skill_versions.approved_by      IS 'Who approved — usually "edmund". Free-text to stay flexible.';
COMMENT ON COLUMN public.skill_versions.rejection_reason IS 'Free-text reason Edmund rejected a proposal. Null unless status=rejected.';

-- Backfill: any row that existed before this migration is implicitly approved.
UPDATE public.skill_versions
SET status      = 'approved',
    approved_at = COALESCE(approved_at, created_at),
    approved_by = COALESCE(approved_by, 'edmund')
WHERE status = 'approved' AND approved_at IS NULL;

-- Partial index for the /inbox/promotions query.
CREATE INDEX IF NOT EXISTS idx_skill_versions_proposed_created_desc
    ON public.skill_versions (created_at DESC)
    WHERE status = 'proposed';
