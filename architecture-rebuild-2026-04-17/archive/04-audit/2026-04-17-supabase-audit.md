# Supabase Audit — 2026-04-17

Project ID: `obizmgugsqirmnjpirnh`

---

## Summary

- **Total tables:** 46 (public schema)
- **Total rows (approximate):** ~5,367
- **Edge functions:** 0 deployed
- **Migrations:** 27 (2026-02-28 through 2026-03-29)
- **Extensions installed:** 5 (pgcrypto, pg_stat_statements, supabase_vault, pg_graphql, uuid-ossp, plpgsql)

**Key observations:**
- The schema is a mixed-purpose database serving three distinct concerns: the GravityClaw agent stack (`agent_*` tables), a content/CMS layer (posts, projects, research, products, services), and the Zealous Parish Ministers / Real+True app (rhythm_plans, suggested_activities, assessment_results, scorecard_responses).
- 8 tables have RLS **disabled** — all are in the competitive intelligence cluster (signals, competitors, content_items, content_topics, ai_analyses, scrape_runs, topics, agent_conversations, agent_scratchpad). This is intentional for agent read access but worth documenting.
- Two scheduling tables exist (`scheduled_tasks` and `agent_scheduled_tasks`) — likely a migration artifact; the older `scheduled_tasks` table appears to be superseded.
- `agent_messages` (354 rows) uses a `bigint` PK with a sequence — inconsistent with the `uuid` PKs used everywhere else.
- `rhythm_plans.user_id` is `text` type, not `uuid` — FK-less, and inconsistent with the `uuid` user_id pattern elsewhere.
- `agent_conversations` and `agent_scratchpad` have no RLS — these store potentially sensitive conversation history.
- `vault_files` has an `anon_read_by_token` policy that allows any anon to read **any** row when their role is anon — the token-based restriction is not enforced at the policy level (the `share_token` check would need to be in the query, not the policy).
- No edge functions are deployed; all agent logic runs via the GravityClaw Railway MCP (to be retired in this rebuild).

---

## Tables

### agent_activity_log
- **Row count:** 2,614
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | created_at | timestamptz | NO |
  | type | text (check: heartbeat/tool_call/error/memory_compact/system) | NO |
  | detail | text | NO |
  | metadata | jsonb | YES |
- **RLS:** enabled
- **Policies:** anon+authenticated can SELECT; service_role full access
- **Notes:** High-volume log table; no index on `created_at` or `type`. Worth adding if queries filter by time window or type.

### agent_conversations
- **Row count:** 11
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | persona_id | text | NO |
  | title | text | NO |
  | messages | jsonb | NO |
  | created_at | timestamptz | YES |
  | updated_at | timestamptz | YES |
- **RLS:** DISABLED
- **Notes:** Stores full conversation message arrays as JSONB. No RLS — world-readable if anon key is exposed. Has duplicate index on `(persona_id, updated_at DESC)`.

### agent_core_memory
- **Row count:** 336
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | created_at | timestamptz | YES |
  | updated_at | timestamptz | YES |
  | key | text (unique) | NO |
  | value | text | NO |
  | category | text | YES |
- **RLS:** enabled
- **Policies:** service_role only
- **Notes:** Key-value store for agent long-term memory. Service-only access is appropriate.

### agent_cost_log
- **Row count:** 486
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | created_at | timestamptz | NO |
  | service | text (check: anthropic/openai/groq/elevenlabs/google) | NO |
  | model | text | NO |
  | tokens_prompt | integer | YES |
  | tokens_completion | integer | YES |
  | cost_usd | numeric | YES |
- **RLS:** enabled
- **Policies:** anon+authenticated can SELECT; service_role full access
- **Notes:** No index on `created_at` or `service`. Useful for cost dashboards; consider indexing.

### agent_data_store
- **Row count:** 18
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | created_at | timestamptz | NO |
  | updated_at | timestamptz | NO |
  | key | text (unique) | NO |
  | value | text | NO |
  | data_type | text (check: number/text/json) | NO |
- **RLS:** enabled
- **Policies:** Multiple overlapping policies — `Enable full access for service role` (uses `auth.jwt()` check), `Enable read access for all users` (open SELECT), and `service_only` (role-based). Redundant policy set.
- **Notes:** General-purpose KV store. Three policies where one would do.

### agent_habits
- **Row count:** 0
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | created_at | timestamptz | NO |
  | name | text | NO |
  | status | text (check: pending/completed/skipped) | YES |
  | completed_at | timestamptz | YES |
- **RLS:** enabled
- **Notes:** Empty table. May be an unused feature placeholder from earlier GravityClaw design.

### agent_messages
- **Row count:** 354
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | bigint (sequence) | NO |
  | role | text | NO |
  | content | text | NO |
  | created_at | timestamptz | YES |
- **RLS:** enabled
- **Policies:** service_role only
- **Notes:** Uses `bigint` sequence PK — the only table not using UUID. No `session_id` or grouping column; all messages appear to be a single flat log. No index on `created_at` or `role`.

### agent_retrieval_feedback
- **Row count:** 0
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | query_text | text | NO |
  | namespace | text | NO |
  | top_result_id | text | YES |
  | top_result_score | float8 | YES |
  | top_result_text | text | YES |
  | feedback | text (check: useful/not_useful/irrelevant) | YES |
  | created_at | timestamptz | YES |
  | was_useful | boolean | YES |
- **RLS:** enabled
- **Notes:** Empty. Designed for Pinecone retrieval feedback loop. Not yet in active use.

### agent_scheduled_tasks
- **Row count:** 0
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | description | text | NO |
  | cron_expression | text | NO |
  | action_type | text | NO |
  | action_payload | jsonb | YES |
  | status | text | NO |
  | next_run_at | timestamptz | YES |
  | last_run_at | timestamptz | YES |
  | created_at | timestamptz | YES |
  | created_by | text | YES |
- **RLS:** enabled
- **Notes:** Empty. Newer, more structured replacement for `scheduled_tasks`. Has a partial index on `(status, next_run_at) WHERE status = 'active'`.

### agent_scratchpad
- **Row count:** 1
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | content | text | NO |
  | source_persona_id | text | YES |
  | source_conversation_id | uuid | YES |
  | created_at | timestamptz | YES |
- **RLS:** DISABLED
- **Notes:** No RLS. Single row. World-readable if anon key is exposed.

### agent_youtube_comments
- **Row count:** 101
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | video_id | text | YES |
  | comment_id | text (unique) | NO |
  | author | text | YES |
  | content | text | YES |
  | like_count | integer | YES |
  | published_at | timestamptz | YES |
  | created_at | timestamptz | YES |
  | sentiment_score | integer | YES |
  | feature_request | text | YES |
- **RLS:** enabled
- **Policies:** anon SELECT; service_role full access
- **Indexes:** `video_id`, `sentiment_score`
- **Notes:** FK to `agent_youtube_videos.video_id`. Well-indexed for its use case.

### agent_youtube_videos
- **Row count:** 362
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | video_id | text | NO |
  | created_at | timestamptz | NO |
  | title | text | NO |
  | published_at | timestamptz | YES |
  | view_count | integer | YES |
  | like_count | integer | YES |
  | comment_count | integer | YES |
  | sentiment_score | numeric | YES |
  | channel_name | text | YES |
  | description | text | YES |
  | channel_id | text | YES |
  | transcript | text | YES |
  | summary | text | YES |
  | tags | text[] | YES |
  | source_url | text | YES |
  | notion_page_id | text | YES |
  | is_owned | boolean | YES |
- **RLS:** enabled
- **Policies:** anon+authenticated SELECT; service_role full access
- **Notes:** No index on `channel_id`, `is_owned`, or `published_at` — all likely query targets. No index on `tags` array either.

### ai_analyses
- **Row count:** 450
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | content_item_id | uuid | YES |
  | competitor_id | uuid | YES |
  | analysis_type | USER-DEFINED (summary/topic_tags/trend_report/strategic_insight) | NO |
  | output | jsonb | NO |
  | generated_at | timestamptz | YES |
- **RLS:** DISABLED
- **Indexes:** `competitor_id`, `analysis_type`
- **Notes:** Part of the competitive intelligence cluster. Both FKs are nullable — possible orphaned analyses if content items are deleted.

### assessment_results
- **Row count:** 2
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | user_id | uuid | NO |
  | director_time | integer (1–4) | NO |
  | director_competency | integer (1–4) | NO |
  | manager_time | integer (1–4) | NO |
  | manager_competency | integer (1–4) | NO |
  | minister_time | integer (1–4) | NO |
  | minister_competency | integer (1–4) | NO |
  | completed_at | timestamptz | YES |
- **RLS:** enabled
- **Policies:** users can manage own records (`auth.uid() = user_id`)
- **Notes:** ZPM app data. Sparse — only 2 rows.

### clients
- **Row count:** 0
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | user_id | uuid | YES |
  | name | text | NO |
  | email | text | NO |
  | address | text | YES |
  | created_at | timestamptz | YES |
- **RLS:** enabled
- **Notes:** Empty. Part of invoicing feature. Uses `uuid_generate_v4()` (uuid-ossp) rather than `gen_random_uuid()` (pg_crypto) — inconsistent with other tables.

### competitors
- **Row count:** 8
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | name | text | NO |
  | website_url | text | YES |
  | content_url | text | YES |
  | youtube_channel_id | text | YES |
  | social_profiles | jsonb | YES |
  | logo_url | text | YES |
  | created_at | timestamptz | YES |
- **RLS:** DISABLED
- **Notes:** Part of competitive intelligence cluster. No indexes beyond PK.

### contact_submissions
- **Row count:** 0
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | name | text | NO |
  | email | text | NO |
  | message | text | NO |
  | read | boolean | NO |
  | created_at | timestamptz | NO |
- **RLS:** enabled
- **Policies:** Public INSERT; authenticated SELECT/UPDATE/DELETE; service_role full access
- **Notes:** Empty. CMS contact form capture. No index on `email` or `read`.

### content_items
- **Row count:** 209
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | competitor_id | uuid | NO |
  | source | USER-DEFINED (youtube/website/social) | NO |
  | content_type | text | NO |
  | title | text | YES |
  | url | text (unique) | NO |
  | published_at | timestamptz | YES |
  | raw_text | text | YES |
  | scraped_at | timestamptz | YES |
  | is_new | boolean | YES |
  | pinecone_id | text | YES |
  | created_at | timestamptz | YES |
- **RLS:** DISABLED
- **Indexes:** `competitor_id`, `published_at DESC`, `source`
- **Notes:** Well-indexed. `pinecone_id` allows cross-referencing with Pinecone vectors.

### content_topics
- **Row count:** 655
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | content_item_id | uuid | NO |
  | topic_id | uuid | NO |
- **RLS:** DISABLED
- **Notes:** Join table. Composite PK serves as the index.

### dc_config
- **Row count:** 2
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | key | text | NO |
  | value | text | YES |
- **RLS:** enabled
- **Policies:** Redundant — two separate SELECT policies for authenticated users exist alongside a catch-all authenticated ALL policy.
- **Notes:** Podcast config store. Redundant RLS policies should be consolidated.

### dc_episodes
- **Row count:** 3
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | season | integer | NO |
  | episode_number | integer | NO |
  | title | text | NO |
  | status | text | NO |
  | recording_date | date | YES |
  | created_at | timestamptz | YES |
- **RLS:** enabled
- **Notes:** Digital Continent podcast. Light data (3 episodes). No unique constraint on `(season, episode_number)`.

### dc_ideas
- **Row count:** 8
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | episode_id | uuid | NO |
  | type | text | NO |
  | content | text | NO |
  | is_greenlit | boolean | YES |
  | created_at | timestamptz | YES |
  | notes | text | YES |
  | is_discussed | boolean | YES |
- **RLS:** enabled

### dc_youtube_assets
- **Row count:** 1
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | episode_id | uuid (unique) | NO |
  | yt_title | text | NO |
  | yt_description | text | NO |
  | tags | text[] | NO |
  | thumbnail_notes | text | NO |
  | chapters | jsonb | NO |
  | created_at | timestamptz | NO |
  | updated_at | timestamptz | NO |
- **RLS:** enabled

### factory_events
- **Row count:** 166
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | session_id | uuid | NO |
  | event_type | text | NO |
  | title | text | YES |
  | branch | text | YES |
  | payload | jsonb | YES |
  | created_at | timestamptz | YES |
- **RLS:** enabled
- **Policies:** anon SELECT; service_role INSERT
- **Indexes:** `created_at DESC`, `session_id`
- **Notes:** Local agent dashboard event log. Anon can read all events — appropriate for a personal dashboard.

### factory_sessions
- **Row count:** 91
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | title | text | NO |
  | description | text | YES |
  | phase | text | YES |
  | status | text | NO |
  | blocking_reason | text | YES |
  | branch | text | YES |
  | handoff_url | text | YES |
  | sprint | text | YES |
  | progress_pct | integer | YES |
  | last_event_type | text | YES |
  | created_at | timestamptz | YES |
  | updated_at | timestamptz | YES |
  | resume_prompt | text | YES |
- **RLS:** enabled
- **Policies:** anon SELECT; service_role full access
- **Indexes:** `status`

### invoice_items
- **Row count:** 0
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | invoice_id | uuid | YES |
  | description | text | NO |
  | quantity | numeric | NO |
  | unit_price | numeric | NO |
  | amount | numeric (generated: quantity * unit_price) | YES |
  | created_at | timestamptz | YES |
- **RLS:** enabled
- **Notes:** Empty. `amount` is a generated column.

### invoices
- **Row count:** 0
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | user_id | uuid | YES |
  | client_id | uuid | YES |
  | invoice_number | text (unique) | NO |
  | status | USER-DEFINED (draft/sent/paid/void) | YES |
  | issue_date | date | YES |
  | due_date | date | YES |
  | total_amount | numeric | YES |
  | stripe_payment_id | text | YES |
  | notes | text | YES |
  | created_at | timestamptz | YES |
- **RLS:** enabled
- **Notes:** Empty. Uses `uuid_generate_v4()` for ID (uuid-ossp dependency).

### lead_magnet_submissions
- **Row count:** 0
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | lead_magnet_id | uuid | YES |
  | first_name | text | NO |
  | email | text | NO |
  | created_at | timestamptz | YES |
- **RLS:** enabled
- **Notes:** Empty. No unique constraint on `email` per lead magnet — could accept duplicate signups.

### lead_magnets
- **Row count:** 4
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | title | text | NO |
  | slug | text (unique) | NO |
  | subtitle | text | YES |
  | description | text | YES |
  | cover_image | text | YES |
  | download_url | text | YES |
  | status | text | YES |
  | created_at | timestamptz | YES |
- **RLS:** enabled

### posts
- **Row count:** 6
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | title | text | NO |
  | slug | text (unique) | NO |
  | excerpt | text | YES |
  | content | text | NO |
  | cover_image | text | YES |
  | published_at | timestamptz | YES |
  | status | text (check: draft/published) | NO |
  | created_at | timestamptz | NO |
  | tags | text[] | YES |
  | lead_magnet_id | uuid | YES |
- **RLS:** enabled
- **Notes:** No index on `status` or `published_at` — both are common filter targets.

### products
- **Row count:** 3
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | title | text | NO |
  | subtitle | text | YES |
  | description | text | YES |
  | price | text | YES |
  | stripe_url | text | YES |
  | cover_preset | text | YES |
  | features | jsonb | YES |
  | status | text | YES |
  | sort_order | integer | YES |
  | created_at | timestamptz | YES |
- **RLS:** enabled

### profiles
- **Row count:** 3
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | full_name | text | YES |
  | parish_name | text | YES |
  | role | text | YES |
  | updated_at | timestamptz | YES |
- **RLS:** enabled
- **Policies:** Users can only view/update their own profile; public INSERT allowed (for signup flow)
- **Notes:** FK to `auth.users.id`. `role` is free-text — no enum constraint.

### projects
- **Row count:** 3
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | title | text | NO |
  | slug | text (unique) | NO |
  | description | text | YES |
  | content | text | YES |
  | cover_image | text | YES |
  | tags | text[] | YES |
  | published_at | timestamptz | YES |
  | status | text (check: draft/published) | NO |
  | created_at | timestamptz | NO |
- **RLS:** enabled

### research
- **Row count:** 4
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | title | text | NO |
  | slug | text (unique) | NO |
  | abstract | text | YES |
  | content | text | YES |
  | research_status | text (check: investigating/completed) | YES |
  | status | text (check: draft/published) | YES |
  | cover_image | text | YES |
  | published_at | timestamptz | YES |
  | created_at | timestamptz | YES |
- **RLS:** enabled
- **Notes:** Two separate status columns (`research_status` and `status`) — could be confusing; worth consolidating.

### rhythm_activities
- **Row count:** 53
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | plan_id | uuid | NO |
  | area | USER-DEFINED (director/manager/minister/spiritual_life/personal_renewal) | NO |
  | cadence | USER-DEFINED (daily/weekly/monthly/quarterly/annually) | NO |
  | text | text | NO |
  | is_custom | boolean | YES |
  | day_of_week | text | YES |
  | time_of_day | text | YES |
- **RLS:** enabled
- **Notes:** ZPM app. No index on `plan_id` beyond the FK constraint.

### rhythm_plans
- **Row count:** 7
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | user_id | text | YES |
  | created_at | timestamptz | YES |
  | updated_at | timestamptz | YES |
- **RLS:** enabled
- **Notes:** `user_id` is `text`, not `uuid`. No FK to `profiles` or `auth.users`. Likely stores Clerk user IDs or similar external IDs rather than Supabase auth UIDs. No index on `user_id`.

### scheduled_tasks
- **Row count:** 7
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | task_type | text | NO |
  | trigger_source | text | NO |
  | objective | text | NO |
  | status | text | YES |
  | result | jsonb | YES |
  | created_at | timestamptz | YES |
  | completed_at | timestamptz | YES |
- **RLS:** enabled
- **Notes:** Older task log/queue table. `agent_scheduled_tasks` is the newer replacement with cron support. This table is likely orphaned.

### scorecard_responses
- **Row count:** 0
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | name | text | YES |
  | email | text | YES |
  | score | smallint (0–10) | NO |
  | stage | smallint (1–4) | NO |
  | q1–q10 | boolean | NO |
  | q11–q14 | text | NO |
  | source | text | YES |
  | referrer | text | YES |
  | created_at | timestamptz | YES |
- **RLS:** enabled
- **Notes:** Empty. `public_update_scorecard` policy allows any anon user to UPDATE any row (`qual: true`) — this is likely unintentional and should be restricted.

### scrape_runs
- **Row count:** 8
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | started_at | timestamptz | YES |
  | completed_at | timestamptz | YES |
  | status | USER-DEFINED (running/completed/failed) | YES |
  | stats | jsonb | YES |
- **RLS:** DISABLED
- **Notes:** Competitive intelligence run log.

### services
- **Row count:** 8
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | name | text | NO |
  | description | text | YES |
  | price | text | YES |
  | features | jsonb | YES |
  | sort_order | integer | NO |
  | category | text | YES |
  | cover_image | text | YES |
- **RLS:** enabled

### signal_source_health
- **Row count:** 40
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | source_name | text | NO |
  | last_checked_at | timestamptz | YES |
  | signals_count | integer | YES |
  | avg_relevancy | numeric | YES |
  | last_error | text | YES |
  | updated_at | timestamptz | YES |
- **RLS:** enabled
- **Policies:** anon SELECT; service_role full access

### signals
- **Row count:** 83
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | text | NO |
  | title | text | NO |
  | url | text | YES |
  | source_name | text | YES |
  | category | text | YES |
  | brand_arm | text | YES |
  | content_type | text | YES |
  | priority | text | YES |
  | summary | text | YES |
  | relevancy_score | integer | YES |
  | relevancy_reason | text | YES |
  | published_at | timestamptz | YES |
  | scraped_at | timestamptz | YES |
  | saved | boolean | YES |
  | dismissed | boolean | YES |
  | dismissed_at | timestamptz | YES |
- **RLS:** DISABLED
- **Notes:** No index on `dismissed`, `saved`, or `scraped_at` — all common filter columns.

### suggested_activities
- **Row count:** 25
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | area | USER-DEFINED (director/manager/minister/spiritual_life/personal_renewal) | NO |
  | cadence | USER-DEFINED (daily/weekly/monthly/quarterly/annually) | NO |
  | text | text | NO |
  | day_of_week | text | YES |
  | time_of_day | text | YES |
- **RLS:** enabled
- **Notes:** ZPM seed data. Public SELECT only. No index on `area` or `cadence`.

### topics
- **Row count:** 20
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | name | text (unique) | NO |
  | description | text | YES |
  | created_at | timestamptz | YES |
- **RLS:** DISABLED

### vault_files
- **Row count:** 16
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | title | text | NO |
  | project | text | NO |
  | file_type | text (check: html/pdf/svg/mp3) | NO |
  | storage_path | text | NO |
  | share_token | uuid (unique) | NO |
  | description | text | YES |
  | file_size_bytes | bigint | YES |
  | mime_type | text | NO |
  | created_at | timestamptz | NO |
  | updated_at | timestamptz | NO |
  | expires_at | timestamptz | YES |
- **RLS:** enabled
- **Policies:** `anon_read_by_token` allows SELECT when `auth.role() = 'anon'` — but does NOT filter by token in the policy itself. Token filtering must happen in the application query. Any anon user querying without a `where share_token =` filter will see all rows.
- **Indexes:** `share_token`, `(project, created_at DESC)`

### waitlist
- **Row count:** 0
- **Columns:**
  | name | type | nullable |
  |---|---|---|
  | id | uuid | NO |
  | email | text (unique) | NO |
  | name | text | YES |
  | created_at | timestamptz | NO |
- **RLS:** enabled

---

## Edge Functions

None deployed.

---

## Extensions

### Installed (active)

| Extension | Version | Schema | Purpose |
|---|---|---|---|
| plpgsql | 1.0 | pg_catalog | Procedural language (default) |
| pgcrypto | 1.3 | extensions | Cryptographic functions |
| pg_stat_statements | 1.11 | extensions | Query performance tracking |
| supabase_vault | 0.3.1 | vault | Secrets management |
| pg_graphql | 1.5.11 | graphql | GraphQL API support |
| uuid-ossp | 1.1 | extensions | UUID generation (`uuid_generate_v4()`) |

### Available but not installed (notable)

- `vector` (0.8.0) — pgvector; not installed, but Pinecone is used instead
- `pg_cron` (1.6.4) — Could replace the current cron scheduling approach
- `pg_net` (0.19.5) — Async HTTP from within DB (useful for webhooks/edge function triggers)
- `pgmq` (1.5.1) — Lightweight message queue on Postgres

---

## Migrations

**Count:** 27  
**Date range:** 2026-02-28 through 2026-03-29

| Version | Name |
|---|---|
| 20260228002117 | create_enums_and_tables |
| 20260228003611 | create_profiles_table |
| 20260228015708 | create_assessment_results_table |
| 20260228214706 | create_dc_podcast_tables |
| 20260228223258 | advanced_ros_features |
| 20260301234143 | categorize_services_and_seed_data |
| 20260302010411 | add_cover_image_to_services |
| 20260302013133 | add_tags_to_posts |
| 20260303184635 | 001_initialize_gravity_claw |
| 20260303212232 | create_agent_data_store |
| 20260303214019 | disable_rls_youtube_videos |
| 20260304004454 | create_scheduled_tasks |
| 20260304031751 | create_agent_messages_table |
| 20260305100129 | agent_core_memory |
| 20260305122928 | add_channel_and_description_to_youtube_videos |
| 20260305123727 | add_youtube_ingest_columns |
| 20260305132247 | enable_rls_on_agent_tables |
| 20260305222611 | secure_open_tables |
| 20260306180642 | fix_dc_rls_policies |
| 20260309222040 | initial_invoice_schema |
| 20260311024722 | 20260310_add_lead_magnet_to_posts |
| 20260329183406 | 003_add_is_owned_to_youtube_videos |
| 20260329183412 | 003_add_sentiment_to_comments |
| 20260329183418 | 004_add_sentiment_to_comments_index |
| 20260329183432 | phase3_retrieval_feedback_table |
| 20260329183440 | sprint2_scheduled_tasks_migration |

---

## Flags

### Security

1. **`scorecard_responses` — open UPDATE policy.** `public_update_scorecard` allows any anon user to UPDATE any row with `qual: true`. This should be locked down or removed unless intentional.

2. **`vault_files` — RLS policy does not enforce token isolation.** `anon_read_by_token` grants SELECT to all anon users without filtering by `share_token` in the policy itself. If any client queries without a token filter, all vault file metadata leaks. Move the token check into the policy: `WHERE share_token = current_setting('request.jwt.claims', true)::json->>'share_token'` or require all queries to include a token predicate enforced server-side.

3. **`agent_conversations` and `agent_scratchpad` have RLS disabled.** These contain conversation history. If the Supabase anon key is ever exposed client-side, this data is world-readable. Consider enabling RLS with a service_role-only policy.

### Schema / Data Quality

4. **`rhythm_plans.user_id` is `text`, not `uuid`.** No FK constraint. Inconsistent with all other user_id columns. If this stores Supabase auth UIDs, it should be `uuid` with a FK. If it stores external IDs (e.g., Clerk), document this.

5. **`agent_messages` uses a `bigint` sequence PK.** Every other table uses `uuid`. If migrating to a new database, this is a minor friction point. No grouping/session column — the table is a flat append-only log with no way to retrieve a conversation thread.

6. **`scheduled_tasks` appears orphaned.** 7 rows remain, but `agent_scheduled_tasks` is the newer design. The old table should be deprecated and drained/dropped after confirming the new table is the active system.

7. **`research` has two status columns** (`research_status` and `status`). Ambiguous — could lead to query errors or inconsistent UI display.

8. **`dc_config` and `agent_data_store` have redundant/conflicting RLS policies.** Multiple overlapping policies on the same table/command can be confusing to audit and maintain. Each table should have one canonical policy per role+command.

9. **`dc_episodes` has no unique constraint on `(season, episode_number)`.** Duplicate episode numbers within a season are currently allowed at the DB level.

### Missing Indexes

10. **`agent_activity_log`** — no index on `created_at` or `type`; 2,614 rows and growing.
11. **`agent_cost_log`** — no index on `created_at` or `service`; 486 rows.
12. **`agent_youtube_videos`** — no index on `channel_id`, `is_owned`, or `published_at`; 362 rows.
13. **`signals`** — no index on `dismissed`, `saved`, or `scraped_at`; 83 rows.
14. **`posts`, `projects`, `research`** — no index on `status` or `published_at`; small now but will matter as content grows.
15. **`rhythm_activities`** — no index on `plan_id` (FK column); 53 rows, but joins will be common.
16. **`suggested_activities`** — no index on `area` or `cadence`; filtered reads are the primary access pattern.

### Rebuild Considerations

17. **Three distinct product concerns share one database.** Agent tables, CMS/website tables, and ZPM app tables are all co-located. The rebuild is a good time to decide if these should be separated into different Supabase projects or kept together.
18. **No edge functions deployed.** All agent business logic lives outside Supabase. The rebuild plan to move unique logic to edge functions starts from zero — no migration required.
19. **`uuid-ossp` vs `gen_random_uuid()` inconsistency.** Some tables (clients, invoices, invoice_items, rhythm_plans, rhythm_activities) use `uuid_generate_v4()` from `uuid-ossp`. Others use `gen_random_uuid()` (built-in since PG 13). Standardize on `gen_random_uuid()` in the rebuild to eliminate the `uuid-ossp` extension dependency.
