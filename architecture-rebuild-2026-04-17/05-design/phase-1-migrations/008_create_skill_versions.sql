-- Migration 008 — 2026-04-17
-- Phase 1: Rich data capture — skill_versions
--
-- Purpose:
--   SOPs-as-Skills (pillar 3) means Skills are living documents that improve over time.
--   We need version history so (a) every change is auditable, (b) we can roll back if a
--   promotion degrades the Skill, and (c) the end-of-session retro can diff versions.
--
--   One row per version. `skill_name` + `version` is unique. Latest version for a given
--   skill_name is just: ORDER BY version DESC LIMIT 1.
--
--   This table stores the canonical Skill body. The on-disk /skills/<name>/ Claude Skill
--   files are exports / deployments of the latest approved row.
--
-- Columns:
--   id            uuid pk
--   skill_name    text — slug-style name (e.g. "triage-inbox", "voice-and-tone",
--                 "youtube-to-playbook"). Matches on-disk directory name.
--   version       int — monotonically increasing per skill_name, starting at 1
--   body          text — the Skill content (markdown body)
--   changelog     text — what changed vs previous version (nullable for v1)
--   created_by    text — who/what wrote this version:
--                  "edmund" | "agent:<session_id>" | "promotion:<observation_id>"
--                  kept free-text to stay flexible
--   metadata      jsonb — references, source observation ids, tags
--   created_at    timestamptz default now()
--   UNIQUE (skill_name, version)
--
-- RLS: enabled. authenticated SELECT (dashboard reads), service_role writes.
--
-- Verification:
--   SELECT count(*) FROM public.skill_versions; -- 0
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'skill_versions'; -- true
--
-- Rollback:
--   DROP TABLE IF EXISTS public.skill_versions CASCADE;

CREATE TABLE IF NOT EXISTS public.skill_versions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_name   text NOT NULL,
    version      integer NOT NULL CHECK (version >= 1),
    body         text NOT NULL,
    changelog    text,
    created_by   text NOT NULL DEFAULT 'edmund',
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (skill_name, version)
);

COMMENT ON TABLE  public.skill_versions IS 'Version history for SOPs-as-Skills (pillar 3). One row per version. Latest = max(version) per skill_name.';
COMMENT ON COLUMN public.skill_versions.skill_name IS 'Slug-style name matching on-disk /skills/<name>/ directory.';
COMMENT ON COLUMN public.skill_versions.version IS 'Monotonically increasing per skill_name, starting at 1. (skill_name, version) is unique.';
COMMENT ON COLUMN public.skill_versions.created_by IS 'Free-text origin: "edmund" | "agent:<session_id>" | "promotion:<observation_id>".';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_name     ON public.skill_versions (skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_versions_created_at_desc ON public.skill_versions (created_at DESC);
-- Fast "latest version per skill" lookup:
CREATE INDEX IF NOT EXISTS idx_skill_versions_name_version_desc
    ON public.skill_versions (skill_name, version DESC);

-- RLS
ALTER TABLE public.skill_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY skill_versions_authenticated_select
    ON public.skill_versions
    FOR SELECT
    TO authenticated
    USING (true);
