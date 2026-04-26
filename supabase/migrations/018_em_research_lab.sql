-- Migration 018 — EM Research Lab schema additions
-- Companion to: ~/Documents/Claude/Projects/Claude Bootstrapper/context/previous-setups/em-research-lab-design.md (v0.2)
-- Phase: 0 (Foundations)
--
-- Purpose: extend the existing reference_docs + observations tables to support
-- the EM Research Lab pipeline. The filesystem at ~/Documents/Claude/Projects/EM Research Lab/
-- is the canonical source of truth; this schema makes Supabase a queryable index
-- over those files and the agent brain for synthesis/compression/staleness.
--
-- Design decisions reflected in this migration:
--   - Flat `kind` values (not the design doc's two-level kind+doc_kind scheme),
--     matching Edmund's existing reference_docs_kinds convention. New lab-specific
--     kinds are added to the lookup table.
--   - `lab_zone` is a new column that namespaces lab rows (inbox / knowledge-atlas /
--     research / ip / archive). NULL for non-lab rows. Replaces the design's
--     coarse kind='knowledge-doc' / kind='ip-doc' bucketing.
--   - `status`, `source_refs`, `reviewed_at`, `review_frequency` enable the
--     staleness mechanism (SQL cron — not an agent).
--   - `notion_task_id` links a recommendation row to a deferred Notion task.
--   - `compression_safe` + `ready_for_promotion` on observations gate the
--     compression cron in factory.
--
-- Verification:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='reference_docs'
--      AND column_name IN ('lab_zone','status','source_refs','reviewed_at','review_frequency','notion_task_id');
--   -- expects: 6 rows
--
--   SELECT count(*) FROM public.reference_docs_kinds
--    WHERE kind IN ('source-summary','source-note','landscape-brief',
--                   'synthesis-memo','recommendation','articulation',
--                   'brand-concept','methodology','landscape-observation',
--                   'sop','reference');
--   -- expects: 11
--
-- Rollback (best-effort — review before running):
--   ALTER TABLE public.reference_docs
--     DROP COLUMN IF EXISTS lab_zone,
--     DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS source_refs,
--     DROP COLUMN IF EXISTS reviewed_at,
--     DROP COLUMN IF EXISTS review_frequency,
--     DROP COLUMN IF EXISTS notion_task_id;
--   ALTER TABLE public.observations
--     DROP COLUMN IF EXISTS compression_safe,
--     DROP COLUMN IF EXISTS ready_for_promotion;
--   DELETE FROM public.reference_docs_kinds
--    WHERE kind IN ('source-summary','source-note','landscape-brief',
--                   'synthesis-memo','recommendation','articulation',
--                   'brand-concept','methodology','landscape-observation',
--                   'sop','reference');

BEGIN;

-- =====================================================================
-- 1. Add new lab-specific kinds to the reference_docs_kinds lookup
-- =====================================================================
INSERT INTO public.reference_docs_kinds (kind) VALUES
  ('source-summary'),         -- atlas/sources/ thin bibliographic entries
  ('source-note'),            -- atlas/documents/ structured analysis of one source
  ('landscape-brief'),        -- atlas/documents/ living state-of-domain brief
  ('synthesis-memo'),         -- research/02-synthesis/ pattern across 3+ sources
  ('recommendation'),         -- inbox/ agent-surfaced "do this next" memo
  ('articulation'),           -- ip/documents/ a way of saying something distinctly Edmund's
  ('brand-concept'),          -- ip/documents/ a brand-level idea or angle
  ('methodology'),            -- ip/documents/ a process Edmund developed
  ('landscape-observation'),  -- promoted observation -> atlas
  ('sop'),                    -- atlas/documents/ step-by-step process
  ('reference')               -- atlas/documents/ methodology, definition, concept
ON CONFLICT (kind) DO NOTHING;

-- =====================================================================
-- 2. Extend reference_docs with lab fields
-- =====================================================================
ALTER TABLE public.reference_docs
  ADD COLUMN IF NOT EXISTS lab_zone         text,
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS source_refs      text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS review_frequency text,
  ADD COLUMN IF NOT EXISTS notion_task_id   text;

-- Constrain lab_zone to known values (NULL = non-lab row).
ALTER TABLE public.reference_docs
  DROP CONSTRAINT IF EXISTS reference_docs_lab_zone_check;
ALTER TABLE public.reference_docs
  ADD  CONSTRAINT reference_docs_lab_zone_check
  CHECK (lab_zone IS NULL OR lab_zone IN
    ('inbox','knowledge-atlas','research','ip','archive'));

-- Constrain status.
ALTER TABLE public.reference_docs
  DROP CONSTRAINT IF EXISTS reference_docs_status_check;
ALTER TABLE public.reference_docs
  ADD  CONSTRAINT reference_docs_status_check
  CHECK (status IN ('current','draft','stale','archived'));

-- Constrain review_frequency (NULL allowed for kinds that don't review).
ALTER TABLE public.reference_docs
  DROP CONSTRAINT IF EXISTS reference_docs_review_frequency_check;
ALTER TABLE public.reference_docs
  ADD  CONSTRAINT reference_docs_review_frequency_check
  CHECK (review_frequency IS NULL OR review_frequency IN
    ('quarterly','annually','on-new-source','never','once'));

-- =====================================================================
-- 3. Indexes for the staleness query and lab-zone lookups
-- =====================================================================
CREATE INDEX IF NOT EXISTS reference_docs_lab_zone_idx
  ON public.reference_docs (lab_zone)
  WHERE lab_zone IS NOT NULL;

CREATE INDEX IF NOT EXISTS reference_docs_status_kind_idx
  ON public.reference_docs (status, kind)
  WHERE status = 'current';

CREATE INDEX IF NOT EXISTS reference_docs_reviewed_at_idx
  ON public.reference_docs (reviewed_at)
  WHERE status = 'current';

-- GIN index over source_refs so "which docs reference source X?" is fast.
CREATE INDEX IF NOT EXISTS reference_docs_source_refs_gin
  ON public.reference_docs USING GIN (source_refs);

-- =====================================================================
-- 4. Extend observations with compression / promotion gates
-- =====================================================================
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS compression_safe     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ready_for_promotion  boolean NOT NULL DEFAULT false;

-- Index for the compression cron's selection query.
CREATE INDEX IF NOT EXISTS observations_compression_ready_idx
  ON public.observations (compression_safe, ready_for_promotion)
  WHERE compression_safe = true OR ready_for_promotion = true;

-- =====================================================================
-- 5. Helper view: stale_lab_docs (used by the staleness SQL cron)
-- =====================================================================
-- Selects current lab docs whose review window has elapsed. The cron job
-- writes this list to /inbox/staleness-[date].md via the lab-staleness-sweep
-- edge function (Phase 4).
DROP VIEW IF EXISTS public.stale_lab_docs;
CREATE VIEW public.stale_lab_docs AS
SELECT
  id,
  slug,
  title,
  kind,
  lab_zone,
  reviewed_at,
  review_frequency,
  CASE review_frequency
    WHEN 'quarterly'    THEN reviewed_at + INTERVAL '3 months'
    WHEN 'annually'     THEN reviewed_at + INTERVAL '1 year'
    WHEN 'on-new-source' THEN NULL  -- handled by source-conflict detection, not time
    WHEN 'never'        THEN NULL
    WHEN 'once'         THEN NULL
    ELSE NULL
  END AS due_at
FROM public.reference_docs
WHERE
  lab_zone IS NOT NULL
  AND status = 'current'
  AND reviewed_at IS NOT NULL
  AND review_frequency IN ('quarterly','annually')
  AND CASE review_frequency
        WHEN 'quarterly' THEN reviewed_at + INTERVAL '3 months'
        WHEN 'annually'  THEN reviewed_at + INTERVAL '1 year'
      END < now();

COMMENT ON VIEW public.stale_lab_docs IS
  'Current lab docs whose review_frequency window has elapsed. Used by the weekly staleness SQL cron (Phase 4) to drop a markdown list into /inbox/staleness-[date].md.';

COMMIT;
