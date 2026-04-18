-- Migration 013 — 2026-04-17
-- Phase 2: match_memory() RPC — semantic search on public.memory
--
-- Applied: 2026-04-17 as `phase_2_013_create_match_memory_rpc` on obizmgugsqirmnjpirnh
--
-- Purpose:
--   Primary retrieval entry point for Edge Functions, Skills, and the Supabase MCP.
--   Modeled on OB-1 `match_thoughts()`.
--
-- Signature:
--   match_memory(
--       query_embedding  vector(1536),
--       match_namespace  text,
--       match_count      int  DEFAULT 10,
--       metadata_filter  jsonb DEFAULT '{}'::jsonb
--   )
--   RETURNS TABLE (id uuid, content text, metadata jsonb, similarity float4)
--
-- Semantics:
--   - Filters by namespace (required — callers must specify which bucket).
--   - Filters by `metadata @> metadata_filter` (containment). Empty filter = no filter.
--   - Orders by cosine distance (embedding <=> query_embedding) ascending.
--   - similarity = 1 - cosine_distance, so higher is more similar (matches OB-1 / Pinecone UX).
--   - Rows with NULL embedding are excluded by the `IS NOT NULL` guard.
--
-- Security:
--   SECURITY INVOKER (runs as caller). search_path pinned to public to prevent schema-hijack.
--   Read via Supabase MCP (service_role) or authenticated role (SELECT policy on memory).
--
-- Verification:
--   SELECT * FROM public.match_memory(
--       array_fill(0.0::real, ARRAY[1536])::vector,
--       'knowledge',
--       5,
--       '{}'::jsonb
--   );  -- returns 0 rows on empty table; no error
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.match_memory(vector, text, int, jsonb);

CREATE OR REPLACE FUNCTION public.match_memory (
    query_embedding  vector(1536),
    match_namespace  text,
    match_count      int   DEFAULT 10,
    metadata_filter  jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    id          uuid,
    content     text,
    metadata    jsonb,
    similarity  float4
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        m.id,
        m.content,
        m.metadata,
        (1 - (m.embedding <=> query_embedding))::float4 AS similarity
    FROM public.memory m
    WHERE m.namespace = match_namespace
      AND m.embedding IS NOT NULL
      AND (metadata_filter = '{}'::jsonb OR m.metadata @> metadata_filter)
    ORDER BY m.embedding <=> query_embedding
    LIMIT greatest(match_count, 1);
$$;

COMMENT ON FUNCTION public.match_memory(vector, text, int, jsonb) IS
    'Semantic search on public.memory. Modeled on OB-1 match_thoughts. Filters by namespace (required) + metadata @> filter (optional). Returns (id, content, metadata, similarity=1-cosine_distance) ordered by similarity desc, capped at match_count.';
