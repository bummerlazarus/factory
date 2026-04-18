-- Migration 014 — 2026-04-17
-- Phase 2: Fix memory unique index for PostgREST upsert compatibility
--
-- Applied: 2026-04-17 as `phase_2_014_fix_memory_unique_index` on obizmgugsqirmnjpirnh
--
-- Purpose:
--   Migration 012 created a PARTIAL unique index on (source, source_id) WHERE source_id IS NOT NULL.
--   PostgreSQL requires the ON CONFLICT target to match a full (non-partial) unique index; PostgREST
--   has no way to express the WHERE predicate on upsert requests. Every PostgREST upsert with
--   `?on_conflict=source,source_id` returned 42P10 ("there is no unique or exclusion constraint
--   matching the ON CONFLICT specification"). The Pinecone→pgvector migration (attempt #3) wrote
--   0 rows because of this: all 134 upsert batches failed with 42P10. Report at
--   /Users/edmundmitchell/factory/ops/scripts/migration-report.md.
--
--   Fix: drop the partial unique index and replace with a FULL unique index on (source, source_id).
--   Postgres treats NULLs as distinct by default (NULLS DISTINCT), so multiple rows with NULL
--   source_id still coexist — which matches the original intent (anonymous rows like non-idempotent
--   conversation turns can still be inserted). PostgREST can now resolve the ON CONFLICT target.
--
-- Verification:
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'memory' ORDER BY indexname;
--   -- expect memory_source_source_id_key (CREATE UNIQUE INDEX ... ON public.memory (source, source_id))
--   -- expect uq_memory_source_source_id to be GONE
--
--   -- Prove NULL source_id rows still coexist:
--   INSERT INTO public.memory (namespace, content, source) VALUES ('_test', 'a', 'test');
--   INSERT INTO public.memory (namespace, content, source) VALUES ('_test', 'b', 'test');
--   -- both inserts succeed; NULL source_ids are distinct.
--   DELETE FROM public.memory WHERE namespace = '_test';
--
-- Rollback:
--   DROP INDEX IF EXISTS public.memory_source_source_id_key;
--   CREATE UNIQUE INDEX uq_memory_source_source_id
--       ON public.memory (source, source_id)
--       WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS public.uq_memory_source_source_id;

CREATE UNIQUE INDEX memory_source_source_id_key
    ON public.memory (source, source_id);
