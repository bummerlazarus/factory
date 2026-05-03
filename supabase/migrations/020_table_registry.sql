-- Migration 020 — table_registry + intent_router
-- Applied 2026-05-02 to project obizmgugsqirmnjpirnh.
-- See proposal at supabase/proposals/table-registry.md.
--
-- Two-table foundation for safe, intent-routed retrieval:
--   table_registry — per-table metadata (domain, layer, canonical status, safe for default retrieval)
--   intent_router  — coarse intent labels → primary/secondary/forbidden tables + query style
--
-- Seed data lives in this same migration so any rebuild from migrations alone
-- reconstructs the registry. To add a new table or intent, INSERT a row.

BEGIN;

CREATE TABLE IF NOT EXISTS public.table_registry (
  table_name        text PRIMARY KEY,
  domain            text NOT NULL,
  layer             text NOT NULL,
  purpose           text NOT NULL,
  canonical_status  text NOT NULL CHECK (canonical_status IN ('canonical','supporting','legacy','scratch','unknown')),
  safe_for_default_retrieval boolean NOT NULL DEFAULT false,
  query_style       text CHECK (query_style IN ('vector','sql','hybrid','none')),
  retrieval_notes   text,
  owner_intent      text[],
  row_count_approx  bigint,
  last_audited_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.table_registry IS
  'Per-table metadata so agents (and Edge Functions) know what each public table is for, whether it is safe to query by default, and which intents it backs. Seeded 2026-05-02 from supabase/proposals/table-registry.md.';

CREATE TABLE IF NOT EXISTS public.intent_router (
  intent           text PRIMARY KEY,
  description      text NOT NULL,
  primary_tables   text[] NOT NULL,
  secondary_tables text[],
  forbidden_tables text[],
  query_style      text NOT NULL CHECK (query_style IN ('vector','sql','hybrid')),
  required_filters jsonb,
  default_limit    int NOT NULL DEFAULT 10,
  notes            text
);

COMMENT ON TABLE public.intent_router IS
  'Maps coarse user-intent labels to canonical tables + filters. Agents classify a question into an intent, look up the routed tables here, then cross-check table_registry before running the query.';

ALTER TABLE public.table_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intent_router  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON public.table_registry;
DROP POLICY IF EXISTS service_role_all ON public.intent_router;

CREATE POLICY service_role_all ON public.table_registry FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.intent_router  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed data — see supabase/proposals/table-registry.md for the rationale per row.
-- Applied directly to project obizmgugsqirmnjpirnh on 2026-05-02 via Supabase MCP
-- (migrations 020b_seed_table_registry, 020c_seed_intent_router). The INSERT
-- statements live in the migration history; this file is the canonical schema +
-- a pointer to the seed migrations.

COMMIT;
