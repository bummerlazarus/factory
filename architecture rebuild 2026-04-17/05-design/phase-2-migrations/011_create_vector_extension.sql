-- Migration 011 — 2026-04-17
-- Phase 2: Consolidate semantic search to pgvector
--
-- Applied: 2026-04-17 as `phase_2_011_create_vector_extension` on obizmgugsqirmnjpirnh
--
-- Purpose:
--   Resolve Q2 (decisions-log entry 2026-04-17) — move semantic search from Pinecone
--   (`gravity-claw` index, 14,491 BYO 3072-dim vectors) into Supabase pgvector. This
--   migration installs the extension only; the table + RPC arrive in 012 and 013.
--
-- Verification:
--   SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';  -- expect one row
--
-- Rollback:
--   DROP EXTENSION IF EXISTS vector;  -- safe only if no tables use the vector type yet

CREATE EXTENSION IF NOT EXISTS vector;

COMMENT ON EXTENSION vector IS 'pgvector — semantic-search backend for Edmund. Installed 2026-04-17 as part of Phase 2 Pinecone->pgvector migration. See architecture rebuild 2026-04-17/03-decisions/decisions-log.md.';
