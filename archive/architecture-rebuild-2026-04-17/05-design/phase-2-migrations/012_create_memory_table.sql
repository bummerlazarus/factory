-- Migration 012 — 2026-04-17
-- Phase 2: Consolidate semantic search to pgvector — `memory` table
--
-- Applied: 2026-04-17 as `phase_2_012_create_memory_table` on obizmgugsqirmnjpirnh
--
-- Purpose:
--   Single-table vector store per data-model.md sketch. Replaces the Pinecone
--   `gravity-claw` index (8 namespaces, 14,491 vectors). `namespace` column replaces
--   Pinecone namespace concept; `metadata jsonb` replaces per-namespace metadata shapes.
--
--   Dimension = 1536 (text-embedding-3-small) per Q2 memo open-sub-question #1. The
--   Pinecone index today is 3072 (text-embedding-3-large); we are re-embedding to
--   1536 during the one-shot migration (see /ops/scripts/migrate-pinecone-to-pgvector.ts).
--   This is the OB-1 default and the Supabase docs default; recall difference at 14K
--   vectors is inside the noise.
--
--   (source, source_id) unique partial constraint lets the migration script and future
--   ingest Edge Functions be idempotent: re-running capture for the same
--   (source='youtube', source_id='yt_<vid>_chunk_3') updates in place.
--
-- Verification:
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'memory';          -- true
--   SELECT indexname FROM pg_indexes WHERE tablename = 'memory' ORDER BY indexname;
--     expect: idx_memory_created_at_desc, idx_memory_embedding_hnsw,
--             idx_memory_metadata_gin, idx_memory_namespace,
--             idx_memory_source_source_id, memory_pkey,
--             uq_memory_source_source_id
--
-- Rollback:
--   DROP TABLE IF EXISTS public.memory CASCADE;

CREATE TABLE IF NOT EXISTS public.memory (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace   text NOT NULL,
    content     text NOT NULL,
    embedding   vector(1536),
    metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
    source      text,
    source_id   text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.memory IS
    'Single-table vector store. Replaces Pinecone gravity-claw index. namespace = Pinecone namespace; metadata jsonb holds per-ingest-type fields (video_id, author, chunk_index, etc.). See architecture-rebuild-2026-04-17/03-decisions/decisions-log.md Q2 entry.';
COMMENT ON COLUMN public.memory.namespace IS
    'Logical bucket: knowledge, conversations, content. Persona-memory namespaces from Pinecone are intentionally NOT migrated (tracked in agent_core_memory / agent_scratchpad).';
COMMENT ON COLUMN public.memory.embedding IS
    '1536-dim. OpenAI text-embedding-3-small. Nullable so rows can be inserted before the embedding call completes (capture() Edge Function pattern).';
COMMENT ON COLUMN public.memory.metadata IS
    'JSONB. Common fields by ingest type: youtube {video_id,url,title,chunk_index,total_chunks}; book {author,filename,folder,chunk_index,total_chunks}; notion {database_id,url,tags}; thought {tags}; competitor {competitor,competitor_id,content_type,topic_tags,published_at}. Normalized during migration.';
COMMENT ON COLUMN public.memory.source IS
    'Ingest channel: youtube | pdf | notion | thought | architecture_guide | website | conversation | etc. Populated consistently during migration.';
COMMENT ON COLUMN public.memory.source_id IS
    'Natural key within source. Used with source for idempotent upserts (unique partial constraint when not null).';

-- Indexes
-- HNSW on embedding (vector_cosine_ops) — default m=16, ef_construction=64. Fine at 14K vectors.
CREATE INDEX IF NOT EXISTS idx_memory_embedding_hnsw
    ON public.memory USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_memory_namespace
    ON public.memory (namespace);

CREATE INDEX IF NOT EXISTS idx_memory_created_at_desc
    ON public.memory (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_source_source_id
    ON public.memory (source, source_id);

CREATE INDEX IF NOT EXISTS idx_memory_metadata_gin
    ON public.memory USING GIN (metadata);

-- Idempotency: unique on (source, source_id) when source_id is set.
-- Partial unique index — allows many NULL source_id rows (e.g. anonymous conversation turns).
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_source_source_id
    ON public.memory (source, source_id)
    WHERE source_id IS NOT NULL;

-- RLS — service_role bypasses (Edge Functions + migration script). authenticated may SELECT.
ALTER TABLE public.memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_authenticated_select
    ON public.memory
    FOR SELECT
    TO authenticated
    USING (true);
