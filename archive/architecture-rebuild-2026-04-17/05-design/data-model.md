# Data Model

**Status:** Informed by audit. See `04-audit/2026-04-17-supabase-audit.md`.

## Principles

- **Source of truth lives in Supabase.** Notion and dashboard are surfaces.
- **RLS on by default** — no new table ships without an explicit policy.
- **Consistent identifiers** — `gen_random_uuid()` for every PK. No `uuid_generate_v4()`, no `bigint` sequences.
- **Every row has `created_at timestamptz`.** Every mutable row has `updated_at timestamptz`.
- **For vector records** (if we consolidate to pgvector or keep Pinecone): consistent field names across indexes/namespaces; one text field per record; no objects-as-values.

## Domain groupings (confirmed by audit)

Five loose groupings currently share one Supabase project:

1. **Agent stack** — `agent_core_memory`, `agent_activity_log`, `agent_messages`, `agent_cost_log`, `agent_youtube_videos`, `agent_youtube_comments`, `agent_instagram_posts`, `agent_scheduled_tasks`, `agent_conversations`, `agent_scratchpad`, `agent_data_store`, `agent_habits`, `agent_retrieval_feedback`
2. **Content / CMS** — `posts`, `projects`, `research`, `products`, `services`, `lead_magnets`, `lead_magnet_submissions`, `contact_submissions`, `waitlist`
3. **ZPM + Real+True app** — `profiles`, `assessment_results`, `scorecard_responses`, `rhythm_plans`, `rhythm_activities`, `suggested_activities`
4. **Competitive intelligence** — `competitors`, `content_items`, `content_topics`, `topics`, `ai_analyses`, `scrape_runs`, `signals`, `signal_source_health`
5. **Digital Continent podcast** — `dc_config`, `dc_episodes`, `dc_ideas`, `dc_youtube_assets`
6. **Commerce / invoicing** — `clients`, `invoices`, `invoice_items`, `vault_files`
7. **Factory (session tracking)** — `factory_sessions`, `factory_events`

Whether these should split across multiple Supabase projects is Q8 in `03-decisions/open-questions.md`.

## Schema fixes to land during rewire

Covered in `05-design/migration-plan.md` Phase 5. Highlights:

**UUID consistency**
- Drop `uuid-ossp` extension dependency
- Migrate: `clients`, `invoices`, `invoice_items`, `rhythm_plans`, `rhythm_activities` from `uuid_generate_v4()` to `gen_random_uuid()`

**`agent_messages`**
- Change `id bigint` → `id uuid`
- Add `session_id uuid NOT NULL` (messages currently are a flat log)
- Add index on `(session_id, created_at DESC)`

**`rhythm_plans`**
- Decide: `user_id uuid` with FK to `auth.users`, or document the external-ID reason

**Dedupe / drop**
- `research.research_status` + `research.status` → consolidate into one
- `scheduled_tasks` — drop after migrating 7 rows
- `agent_habits` — 0 rows, drop unless planned
- `dc_config` / `agent_data_store` — consolidate redundant RLS policies

**Index additions** — see Phase 5 of the migration plan for the full list.

**Security** — see Phase 0.5 of the migration plan.

## Naming conventions (established)

- Tables: `snake_case`, plural, domain prefix where disambiguation helps (`agent_*`, `dc_*`, `rhythm_*`)
- Columns: `snake_case`
- Timestamps: `created_at`, `updated_at` (`timestamptz`)
- Foreign keys: `<table_singular>_id`
- Indexes: default btree on FKs + `created_at`; partial indexes for common filters (`WHERE status = 'active'` pattern seen in `agent_scheduled_tasks`)
- Vector columns: `embedding vector(N)`; HNSW index with `vector_cosine_ops`

## If we install pgvector (resolves Q2 toward consolidation)

Core table modeled on OB-1's `thoughts`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE memory (
    id            uuid        primary key default gen_random_uuid(),
    namespace     text        not null,
    content       text        not null,
    embedding     vector(1536),
    metadata      jsonb       not null default '{}'::jsonb,
    created_at    timestamptz not null default now()
);

CREATE INDEX idx_memory_namespace ON memory (namespace);
CREATE INDEX idx_memory_metadata  ON memory USING GIN (metadata);
CREATE INDEX idx_memory_embedding ON memory USING hnsw (embedding vector_cosine_ops);
```

Plus a `match_memory(query_embedding, namespace, threshold, count, filter)` RPC mirroring OB-1's `match_thoughts`.

**Namespace** replaces Pinecone's namespace concept. Metadata filters via `@>` on JSONB (cleaner than Pinecone).

Open question: embedding dimension. OpenAI `text-embedding-3-small` = 1536; `text-embedding-3-large` = 3072 (current Pinecone) or truncated to 1536. OpenRouter hosted options are also 1536-dim. Migration cost is one-time re-embedding of 14,491 vectors.
