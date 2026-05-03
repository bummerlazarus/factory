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

-- Seed: table_registry (65 rows — every public table as of 2026-05-03).
-- Idempotent: ON CONFLICT updates so re-running keeps the registry in sync.
INSERT INTO public.table_registry (table_name, domain, layer, purpose, canonical_status, safe_for_default_retrieval, query_style, retrieval_notes, owner_intent) VALUES
  ('agent_activity_log','agents','log','Per-action activity stream.','supporting',false,'sql','Debug only.', ARRAY['agent_debugging']),
  ('agent_conversations','sessions','raw','Older persona-conversation table; overlaps sessions.','legacy',false,'sql','Flag for consolidation.', NULL),
  ('agent_core_memory','agents','atlas','Key/value persona memory. Overlaps reference_docs.','legacy',false,'sql','Audit + migrate.', NULL),
  ('agent_cost_log','agents','metric','Cost rollup. Internal observability.','supporting',false,'sql','Not retrieval.', NULL),
  ('agent_data_store','agents','config','Generic key/value store.','supporting',false,'sql','Probably config; name suggests scratch.', NULL),
  ('agent_memory','agents','raw','Older per-agent memory. Pre-memory table.','legacy',false,'sql','Audit + migrate.', NULL),
  ('agent_messages','sessions','raw','Verbose conversation transcripts.','supporting',false,'sql','Debug only — explicit session_id required.', ARRAY['agent_debugging']),
  ('agent_retrieval_feedback','memory','observation','Future thumbs-up/down log on retrieval.','scratch',false,'sql','Currently sparse.', NULL),
  ('agent_run_logs','agents','log','Token/cost/tool-call detail per run.','supporting',false,'sql','Debug only.', ARRAY['agent_debugging']),
  ('agent_scheduled_tasks','tasks','task','Cron-style scheduled actions.','canonical',true,'sql','For workflow_planning surface.', ARRAY['workflow_planning']),
  ('agent_scratchpad','agents','scratch','Explicit scratchpad.','scratch',false,'sql','Never default retrieval.', NULL),
  ('agent_tasks','tasks','task','Inter-agent task queue.','canonical',true,'sql','Filter by status.', ARRAY['workflow_planning','project_status']),
  ('agent_wake_queue','agents','task','Internal wake-queue plumbing.','supporting',false,'sql','Debug only.', ARRAY['agent_debugging']),
  ('agent_youtube_comments','content','raw','YouTube comment data.','supporting',false,'sql','Supplementary signal.', NULL),
  ('agent_youtube_videos','content','summary','Per-video metadata + transcript + summary.','canonical',true,'hybrid','Owned-channel detection via is_owned.', ARRAY['content_idea_lookup','content_performance']),
  ('agents','agents','atlas','Agent persona registry (identity_md, claude_md, soul_md).','canonical',true,'sql','Filter archived=false.', NULL),
  ('ai_analyses','content','observation','LLM analyses keyed to content_items/competitors.','supporting',false,'sql','business_lookup only.', ARRAY['business_lookup']),
  ('assessment_results','assessments','summary','ZPM assessment scores. PII.','supporting',false,'sql','Explicit-intent only.', NULL),
  ('beehiiv_post_metrics','content','metric','Newsletter performance.','canonical',true,'sql','Per-post upserts.', ARRAY['content_performance']),
  ('clients','clients','atlas','Client roster. PII.','supporting',false,'sql','Explicit-intent only.', NULL),
  ('competitors','content','atlas','Competitor registry.','supporting',false,'sql','Filter target only.', ARRAY['business_lookup']),
  ('contact_submissions','intake','intake','Contact form leads. PII.','supporting',false,'sql','Explicit-intent only.', NULL),
  ('content_items','content','raw','Competitor-scraped content.','supporting',false,'sql','business_lookup only.', ARRAY['business_lookup']),
  ('content_metrics','content','metric','Time-series snapshots across platforms.','canonical',true,'sql','Needs fetched_at window.', ARRAY['content_performance']),
  ('content_topics','knowledge','atlas','Content↔topic join table.','supporting',false,'sql','JOIN only.', NULL),
  ('dc_config','dc','config','DC config.','supporting',false,'sql','Config only.', NULL),
  ('dc_episodes','dc','atlas','DC podcast episode registry.','canonical',true,'sql','DC-scoped intents only.', ARRAY['content_idea_lookup','content_performance']),
  ('dc_ideas','dc','summary','Episode idea bank.','canonical',true,'sql','DC-scoped intents only.', ARRAY['content_idea_lookup']),
  ('dc_youtube_assets','dc','artifact','Per-episode YT metadata.','supporting',false,'sql','DC-scoped only.', NULL),
  ('factory_events','sessions','log','Event stream within a factory_session.','supporting',false,'sql','Debug/replay only.', ARRAY['agent_debugging']),
  ('factory_sessions','sessions','log','Sprint/branch-scoped session registry.','canonical',true,'sql','For project_status surface.', ARRAY['project_status']),
  ('ingest_runs','ingest','log','Single source of ingest health.','canonical',true,'sql','For ingestion_status only.', ARRAY['ingestion_status']),
  ('intent_router','meta','config','Intent → tables mapping.','canonical',false,'sql','Read by route_query.', NULL),
  ('invoice_items','commerce','log','Financial line items.','supporting',false,'sql','Explicit-intent only.', NULL),
  ('invoices','commerce','log','Financial. Never general retrieval.','supporting',false,'sql','Explicit-intent only.', NULL),
  ('lead_magnet_submissions','intake','intake','Lead-magnet submissions. PII.','supporting',false,'sql','Explicit-intent only.', NULL),
  ('lead_magnets','marketing-site','artifact','Lead-magnet catalog.','supporting',false,'sql','business_lookup only.', ARRAY['business_lookup']),
  ('memory','memory','raw','Single-table pgvector store. Default semantic-search target.','canonical',true,'vector','Filter by namespace to scope.', ARRAY['memory_lookup','research_question','content_idea_lookup']),
  ('memory_dualread_log','ingest','log','Pinecone→pgvector parity log.','legacy',false,'sql','Cutover artifact — retire post-cutover.', NULL),
  ('observations','knowledge','observation','Agent-flagged candidate SOPs/preferences.','canonical',false,'sql','Require approved_at IS NOT NULL OR ready_for_promotion=true.', NULL),
  ('posts','marketing-site','artifact','Public blog posts.','supporting',false,'sql','business_lookup only.', ARRAY['business_lookup']),
  ('products','commerce','artifact','Storefront catalog.','supporting',false,'sql','business_lookup only.', ARRAY['business_lookup']),
  ('profiles','clients','atlas','User profiles. PII.','supporting',false,'sql','Explicit-intent only.', NULL),
  ('projects','marketing-site','artifact','Public portfolio table — NAME COLLISION with workstreams.','supporting',false,'sql','Rename candidate (portfolio_projects). Do NOT use for project_status.', ARRAY['business_lookup']),
  ('reference_docs','knowledge','atlas','Goals, KPIs, frameworks, CLAUDE-style docs. One row per slug.','canonical',true,'hybrid','Filter status=active. Vector-search body, exact-match slug.', ARRAY['concept_lookup']),
  ('reference_docs_kinds','knowledge','config','Vocabulary table for reference_docs.kind FK.','supporting',false,'sql','Validation only.', NULL),
  ('research','marketing-site','artifact','Public research-page artifacts.','supporting',false,'sql','Distinct from research_question intent.', ARRAY['business_lookup']),
  ('rhythm_activities','clients','task','Activities within a plan. PII.','supporting',false,'sql','Explicit-intent only.', NULL),
  ('rhythm_plans','clients','atlas','Per-user rhythm plan. PII.','supporting',false,'sql','Explicit-intent only.', NULL),
  ('scorecard_responses','assessments','intake','14-question scorecard. PII.','supporting',false,'sql','Explicit-intent only.', NULL),
  ('scrape_runs','signals','log','Scraper run log.','supporting',false,'sql','Status only.', ARRAY['ingestion_status']),
  ('services','commerce','artifact','Service catalog.','supporting',false,'sql','business_lookup only.', ARRAY['business_lookup']),
  ('sessions','sessions','log','One row per Claude conversation/agent run.','canonical',true,'sql','Order by created_at desc.', ARRAY['recent_activity']),
  ('signal_source_health','signals','metric','Source-health observability.','supporting',false,'sql','Debug only.', ARRAY['agent_debugging','ingestion_status']),
  ('signals','signals','summary','Curated trend signals (saved/dismissed).','canonical',true,'hybrid','Filter dismissed=false.', ARRAY['research_question','content_idea_lookup']),
  ('skill_versions','knowledge','atlas','SOPs-as-skills version history.','canonical',true,'hybrid','Filter status=active and latest version per skill_name.', ARRAY['workflow_planning']),
  ('slack_messages','agents','raw','Slack archive.','supporting',false,'sql','Debug/explicit-intent only.', ARRAY['agent_debugging']),
  ('suggested_activities','clients','atlas','Static suggestion library.','supporting',false,'sql','Could become canonical for rhythm_lookup intent — not in scope today.', NULL),
  ('table_registry','meta','config','Per-table metadata (this table).','canonical',false,'sql','Self-describing config.', NULL),
  ('topics','knowledge','atlas','Topic taxonomy.','supporting',false,'sql','Filter/JOIN target only.', NULL),
  ('vault_files','memory','artifact','File storage registry.','supporting',false,'sql','business_lookup when asked about a specific file.', ARRAY['business_lookup']),
  ('waitlist','intake','intake','Waitlist signups. PII.','supporting',false,'sql','Explicit-intent only.', NULL),
  ('work_log','sessions','summary','Agent-written what-got-pushed-forward log.','canonical',true,'sql','Order by created_at desc; project filter optional.', ARRAY['recent_activity','project_status']),
  ('workspace_items','tasks','task','Older task/spec object — overlaps agent_tasks.','legacy',false,'sql','Flag for consolidation.', NULL),
  ('workstreams','tasks','atlas','Canonical project/workstream registry. FK target.','canonical',true,'sql','Use for project_status. Not public.projects.', ARRAY['project_status'])
ON CONFLICT (table_name) DO UPDATE SET
  domain = EXCLUDED.domain,
  layer = EXCLUDED.layer,
  purpose = EXCLUDED.purpose,
  canonical_status = EXCLUDED.canonical_status,
  safe_for_default_retrieval = EXCLUDED.safe_for_default_retrieval,
  query_style = EXCLUDED.query_style,
  retrieval_notes = EXCLUDED.retrieval_notes,
  owner_intent = EXCLUDED.owner_intent,
  last_audited_at = now();

-- Seed: intent_router (11 intents).
INSERT INTO public.intent_router (intent, description, primary_tables, secondary_tables, forbidden_tables, query_style, required_filters, default_limit, notes) VALUES
  ('agent_debugging','Replay or investigate an agent run.',
    ARRAY['agent_run_logs','agent_activity_log','factory_events'],
    ARRAY['agent_messages','agent_wake_queue','slack_messages','memory_dualread_log'],
    NULL,'sql', NULL, 50,
    'Always require an explicit session_id or time window.'),
  ('business_lookup','Public business surface (site/products/services/competitors).',
    ARRAY['posts','services','products','lead_magnets','competitors','clients'],
    ARRAY['vault_files','ai_analyses'],
    NULL,'sql', NULL, 15,
    'PII tables (clients, profiles, *_submissions, invoices) require explicit pii_ok=true flag from the caller.'),
  ('concept_lookup','Find a goal/value/KPI/framework doc by topic or slug.',
    ARRAY['reference_docs'],
    ARRAY['skill_versions','memory'],
    NULL,'hybrid', '{"reference_docs":{"status":"active"}}'::jsonb, 10,
    'Vector-search body, exact-match slug.'),
  ('content_idea_lookup','Surface candidate content ideas (own catalog or external signal).',
    ARRAY['dc_ideas','signals','agent_youtube_videos'],
    ARRAY['memory'], NULL,'hybrid', NULL, 15,
    'Scope hint by is_owned / channel_id / season.'),
  ('content_performance','How a piece or platform performed over time.',
    ARRAY['content_metrics','agent_youtube_videos','beehiiv_post_metrics'],
    NULL, NULL,'sql', '{"content_metrics":{"window":"30d"}}'::jsonb, 30,
    'Time-series — needs fetched_at window.'),
  ('ingestion_status','Health of ingest pipelines.',
    ARRAY['ingest_runs'],
    ARRAY['scrape_runs','signal_source_health'],
    NULL,'sql', '{"ingest_runs":{"order_by":"started_at desc"}}'::jsonb, 20, NULL),
  ('memory_lookup','Semantic search over the corpus.',
    ARRAY['memory'],
    ARRAY['reference_docs'],
    NULL,'vector', NULL, 10,
    'Optional namespace filter; default top_k=10.'),
  ('project_status','State of a specific workstream/project.',
    ARRAY['workstreams','agent_tasks','work_log'],
    ARRAY['factory_sessions'],
    ARRAY['projects'],'hybrid', '{"agent_tasks":{"status_not":"done"}}'::jsonb, 30,
    'Join on project_slug/workstreams.slug. Public.projects is the marketing portfolio, not the workstream registry.'),
  ('recent_activity','What got pushed forward recently across projects.',
    ARRAY['work_log','sessions'],
    ARRAY['factory_sessions','factory_events','agent_tasks'],
    NULL,'sql', '{"work_log":{"order_by":"created_at desc"}}'::jsonb, 20,
    'Optional project filter.'),
  ('research_question','Open question / what does the corpus know about X.',
    ARRAY['memory','signals'],
    ARRAY['reference_docs','ai_analyses'],
    NULL,'hybrid',
    '{"memory":{"namespace_in":["research","articles","youtube"]},"signals":{"dismissed":false}}'::jsonb, 15, NULL),
  ('workflow_planning','Plan or schedule work / look up SOP.',
    ARRAY['skill_versions','agent_scheduled_tasks','agent_tasks'],
    ARRAY['workstreams','reference_docs'],
    NULL,'hybrid', '{"skill_versions":{"status":"active","latest_version_only":true}}'::jsonb, 15, NULL)
ON CONFLICT (intent) DO UPDATE SET
  description = EXCLUDED.description,
  primary_tables = EXCLUDED.primary_tables,
  secondary_tables = EXCLUDED.secondary_tables,
  forbidden_tables = EXCLUDED.forbidden_tables,
  query_style = EXCLUDED.query_style,
  required_filters = EXCLUDED.required_filters,
  default_limit = EXCLUDED.default_limit,
  notes = EXCLUDED.notes;

COMMIT;
