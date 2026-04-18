# Supabase Inventory

**Status:** Audited 2026-04-17. Full raw audit at `04-audit/2026-04-17-supabase-audit.md`.

## Project

- **Project ID:** `obizmgugsqirmnjpirnh`
- **Total tables:** 46 (public schema)
- **Total rows (approx):** ~5,367
- **Edge functions deployed:** 0
- **Migrations:** 27 (2026-02-28 through 2026-03-29)
- **Extensions active:** plpgsql, pgcrypto, pg_stat_statements, supabase_vault, pg_graphql, uuid-ossp

## Three distinct concerns share one DB

| Cluster | Tables | Notes |
|---|---|---|
| **GravityClaw agent stack** | `agent_*` tables (11 tables) | Core agent memory, logs, scheduling |
| **Content/CMS layer** | posts, projects, research, products, services, lead_magnets, contact_submissions, waitlist | Website CMS |
| **ZPM / Real+True app** | rhythm_plans, rhythm_activities, suggested_activities, assessment_results, scorecard_responses, profiles | App data |
| **Competitive intelligence** | signals, competitors, content_items, content_topics, ai_analyses, scrape_runs, topics | No RLS |
| **Digital Continent podcast** | dc_config, dc_episodes, dc_ideas, dc_youtube_assets | Light data |
| **Invoicing** | clients, invoices, invoice_items | All empty |
| **Factory dashboard** | factory_sessions, factory_events | Active — 91 sessions, 166 events |

## Key tables

| Table | Rows | Status | Notes |
|---|---|---|---|
| `agent_activity_log` | 2,614 | Active | No index on `created_at` or `type` |
| `agent_core_memory` | 336 | Active | Key-value long-term memory; service_role only |
| `agent_cost_log` | 486 | Active | No index on `created_at` or `service` |
| `agent_youtube_videos` | 362 | Active | No index on `channel_id`, `is_owned`, `published_at` |
| `agent_youtube_comments` | 101 | Active | Well-indexed |
| `agent_messages` | 354 | Active | Flat log, no session grouping, `bigint` PK (inconsistent) |
| `factory_sessions` | 91 | Active | Local dashboard session tracking |
| `factory_events` | 166 | Active | Local dashboard event log |
| `signals` | 83 | Active | No index on `dismissed`, `saved`, `scraped_at`; RLS disabled |
| `ai_analyses` | 450 | Active | Competitive intelligence; RLS disabled |
| `content_items` | 209 | Active | Competitor content; RLS disabled |
| `agent_conversations` | 11 | Sparse | RLS disabled — world-readable if anon key exposed |
| `agent_retrieval_feedback` | 0 | Empty | Write path never wired |
| `agent_scheduled_tasks` | 0 | Empty | Newer design; supersedes `scheduled_tasks` |
| `agent_habits` | 0 | Empty | Unused feature placeholder |
| `scheduled_tasks` | 7 | Orphaned | Superseded by `agent_scheduled_tasks` |
| `clients` / `invoices` / `invoice_items` | 0 | Empty | Invoicing feature never used |
| `lead_magnet_submissions` | 0 | Empty | |
| `waitlist` | 0 | Empty | |

## Edge Functions

None deployed. All agent business logic runs on Railway (GravityClaw). Starting from zero — no migration needed.

## Notable extensions not yet installed

| Extension | What it enables |
|---|---|
| `vector` (pgvector) | Semantic search in Postgres — not installed; Pinecone used instead |
| `pg_cron` | Data-layer scheduled jobs without an agent session |
| `pg_net` | Async HTTP from DB (webhook/edge function triggers) |
| `pgmq` | Lightweight message queue on Postgres |

## Security flags

1. **`scorecard_responses`** — `public_update_scorecard` policy allows any anon to UPDATE any row (`qual: true`). Likely unintentional.
2. **`vault_files`** — `anon_read_by_token` grants SELECT to all anon users without filtering by token in the policy. Token check must be in the query, not just the policy. Any query without a `WHERE share_token =` leaks all vault file metadata.
3. **`agent_conversations` + `agent_scratchpad`** — RLS disabled. Contains conversation history. World-readable if the anon key is ever exposed client-side.

## Schema quality flags

4. **`rhythm_plans.user_id` is `text`, not `uuid`** — no FK, inconsistent. Likely stores external Clerk IDs; should be documented or normalized.
5. **`agent_messages` uses `bigint` sequence PK** — every other table uses `uuid`. No `session_id` column — flat append-only log with no thread retrieval.
6. **`scheduled_tasks` appears orphaned** — 7 old rows; `agent_scheduled_tasks` is the active design. Drain and drop.
7. **`research` has two status columns** (`research_status` + `status`) — ambiguous.
8. **`dc_config` + `agent_data_store`** — redundant/conflicting RLS policies. Multiple overlapping policies per role+command.
9. **`dc_episodes`** — no unique constraint on `(season, episode_number)`.
10. **`uuid-ossp` vs `gen_random_uuid()` inconsistency** — some tables use `uuid_generate_v4()`, others use built-in `gen_random_uuid()`. Standardize on `gen_random_uuid()` in the rebuild.

## Missing indexes

| Table | Missing index on |
|---|---|
| `agent_activity_log` | `created_at`, `type` |
| `agent_cost_log` | `created_at`, `service` |
| `agent_youtube_videos` | `channel_id`, `is_owned`, `published_at` |
| `signals` | `dismissed`, `saved`, `scraped_at` |
| `posts`, `projects`, `research` | `status`, `published_at` |
| `rhythm_activities` | `plan_id` (FK column) |
| `suggested_activities` | `area`, `cadence` |

## Rebuild recommendations

1. **Decide if three concerns should separate.** Agent tables, CMS, and ZPM app share one DB. The rebuild is the right time to split if they'll diverge (e.g., ZPM becomes a real product with its own auth).
2. **Deploy Edge Functions starting from zero.** No cleanup needed — Railway currently owns all logic.
3. **Enable pgvector if consolidating away from Pinecone.** Not urgent now but the extension is available.
4. **Fix security flags 1–3 before exposing any client-side Supabase key.**
5. **Add `pg_cron` for data-layer scheduled jobs** (signal ingest, YouTube sync) that shouldn't require an agent session.
