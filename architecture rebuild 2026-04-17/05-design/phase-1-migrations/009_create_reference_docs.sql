-- Migration 009 — 2026-04-17
-- Phase 1: Rich data capture — reference_docs
--
-- Purpose:
--   One source of truth (pillar 2) for the docs that are scattered across Claude projects,
--   local folders, and GitHub today: goals, values, KPIs, frameworks, CLAUDE.md-style docs.
--
--   Every agent consults these. Current pain: "which version is current?" This table ends
--   that — one row per slug, `version` increments on update, old versions live in the
--   history (see note on versioning below).
--
--   Unlike skill_versions (which keeps every version as its own row for SOPs), reference_docs
--   optimizes for "get the current doc by slug" — it carries a simple `version` counter and
--   the current `body`. If we need full history later, we can add a `reference_doc_versions`
--   table. For v1 that's out of scope — Edmund asked for a flat store of canonical docs.
--
-- Columns:
--   id          uuid pk
--   slug        text unique — e.g. "goals-2026", "voice-and-tone", "kpi-dashboard",
--                "values", "em-framework". Matches how on-disk markdown files are named.
--   title       text — human-readable title
--   body        text — markdown body
--   kind        text enum — category for UI grouping
--   version     int — increments on every body update (app-side or trigger-side; not DB-enforced here)
--   metadata    jsonb — tags, source links, related doc slugs
--   updated_at  timestamptz default now()
--   created_at  timestamptz default now()
--
-- RLS: enabled. authenticated SELECT, service_role writes.
--
-- Verification:
--   SELECT count(*) FROM public.reference_docs; -- 0
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'reference_docs'; -- true
--
-- Rollback:
--   DROP TABLE IF EXISTS public.reference_docs CASCADE;

CREATE TABLE IF NOT EXISTS public.reference_docs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text NOT NULL UNIQUE,
    title       text NOT NULL,
    body        text NOT NULL DEFAULT '',
    kind        text NOT NULL DEFAULT 'doc'
                 CHECK (kind IN (
                     'goal',
                     'value',
                     'kpi',
                     'framework',
                     'claude_md',
                     'principle',
                     'persona',
                     'playbook',
                     'doc'
                 )),
    version     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.reference_docs IS 'Canonical goal/value/KPI/framework/CLAUDE.md-style docs. One row per slug. Pillar 2: one source of truth.';
COMMENT ON COLUMN public.reference_docs.slug IS 'Stable identifier, matches on-disk filename. Change body, not slug.';
COMMENT ON COLUMN public.reference_docs.version IS 'Increments on body updates. History is not retained in this table (v1 scope).';

-- Indexes (slug already uniquely indexed)
CREATE INDEX IF NOT EXISTS idx_reference_docs_kind            ON public.reference_docs (kind);
CREATE INDEX IF NOT EXISTS idx_reference_docs_updated_at_desc ON public.reference_docs (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reference_docs_metadata_gin    ON public.reference_docs USING GIN (metadata);

-- Keep updated_at fresh on UPDATE. Tiny trigger, avoids relying on the app to remember.
CREATE OR REPLACE FUNCTION public.reference_docs_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reference_docs_set_updated_at ON public.reference_docs;
CREATE TRIGGER trg_reference_docs_set_updated_at
    BEFORE UPDATE ON public.reference_docs
    FOR EACH ROW
    EXECUTE FUNCTION public.reference_docs_set_updated_at();

-- RLS
ALTER TABLE public.reference_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY reference_docs_authenticated_select
    ON public.reference_docs
    FOR SELECT
    TO authenticated
    USING (true);
