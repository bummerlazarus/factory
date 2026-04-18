-- Migration 015 — Phase 2.5 dual-read instrumentation
-- Applied: 2026-04-17 as `phase_2_015_create_memory_dualread_log` on obizmgugsqirmnjpirnh
--
-- Purpose: log side-by-side comparisons between pgvector match_memory() and
-- Pinecone search-records during the dual-read window. Supports the parity
-- report (W1.4) and any regression sweeps before Pinecone decommission (W9.3).
--
-- Populated by the /supabase/functions/_shared/dualread.ts helper, which callers
-- (Edge Functions, Skills, one-off scripts) invoke when they want to log a
-- comparison. Primary result returned to the caller is pgvector; Pinecone is a
-- shadow read with errors swallowed and logged as metadata.error.
--
-- Columns:
--   query             the caller-provided query text (for humans reading the log)
--   namespace         memory namespace filter (required)
--   top_k             the requested match_count
--   pgvector_results  [{id, pinecone_id, similarity, content_preview}]
--   pinecone_results  [{id, score, content_preview}]
--   overlap_count     # of ids present in both result sets (matched on pinecone_id)
--   jaccard           overlap / union — NULL if either side failed
--   pgvector_ms       latency for the pgvector call
--   pinecone_ms       latency for the pinecone call (NULL if Pinecone failed)
--   caller            free-text tag identifying the calling function/skill
--   metadata          catch-all: {error, model, filter, ...}
--
-- Verification: SELECT count(*) FROM public.memory_dualread_log; -- 0
--
-- Rollback: DROP TABLE IF EXISTS public.memory_dualread_log CASCADE;

CREATE TABLE IF NOT EXISTS public.memory_dualread_log (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    query             text NOT NULL,
    namespace         text NOT NULL,
    top_k             int NOT NULL,
    pgvector_results  jsonb NOT NULL DEFAULT '[]'::jsonb,
    pinecone_results  jsonb NOT NULL DEFAULT '[]'::jsonb,
    overlap_count     int NOT NULL DEFAULT 0,
    jaccard           numeric(4,3),
    pgvector_ms       int,
    pinecone_ms       int,
    caller            text,
    metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.memory_dualread_log IS
    'Dual-read parity log for Pinecone → pgvector cutover. Each row is one side-by-side search comparison. See /supabase/functions/_shared/dualread.ts.';

CREATE INDEX IF NOT EXISTS idx_memory_dualread_log_created_at_desc
    ON public.memory_dualread_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_dualread_log_namespace
    ON public.memory_dualread_log (namespace);

CREATE INDEX IF NOT EXISTS idx_memory_dualread_log_low_jaccard
    ON public.memory_dualread_log (jaccard)
    WHERE jaccard < 0.8;

ALTER TABLE public.memory_dualread_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY dualread_authenticated_select
    ON public.memory_dualread_log
    FOR SELECT
    TO authenticated
    USING (true);
