# Phase 2 migrations — pgvector + memory table + match_memory()

**Status:** APPLIED to Supabase project `obizmgugsqirmnjpirnh` on 2026-04-17. Fix-up migration `014_fix_memory_unique_index` applied later that day — see note under "Apply order".

**Why this phase:** Resolves Q2 from the decisions log — consolidate semantic search into Supabase pgvector, retiring the Pinecone `gravity-claw` BYO index. See:

- `../../03-decisions/decisions-log.md` — "Q2 resolved: consolidate semantic search to pgvector in Supabase" (2026-04-17)
- `../../04-audit/2026-04-17-q2-vector-strategy-memo.md` — full rationale + 7 open sub-questions with leanings
- `../../04-audit/2026-04-17-pinecone-audit.md` — current state (14,491 vectors, 3072-dim BYO, 8 namespaces)
- `../data-model.md` — schema sketch

Phase 2 intentionally **only builds the destination**. The data migration is a separate, Edmund-approved step driven by `/ops/scripts/migrate-pinecone-to-pgvector.ts`.

## Apply order

Strictly sequential — each depends on the previous.

| # | File | Migration name on Supabase | Depends on |
|---|---|---|---|
| 1 | `011_create_vector_extension.sql` | `phase_2_011_create_vector_extension` | — |
| 2 | `012_create_memory_table.sql` | `phase_2_012_create_memory_table` | 011 (vector type) |
| 3 | `013_create_match_memory_rpc.sql` | `phase_2_013_create_match_memory_rpc` | 012 (table + embedding column) |
| 4 | `014_fix_memory_unique_index.sql` | `phase_2_014_fix_memory_unique_index` | 012 (partial index it replaces) |

Migrations 011–013 were applied via Supabase MCP `apply_migration` on 2026-04-17 at build time. Migration 014 was applied later that day after the migration-script execution attempt #3 surfaced a PostgREST-incompatibility with the partial unique index from 012. Applying in file order reproduces the live state.

**Note on 014's relationship to phase-3:** phase-3 has its own migration numbered `014` in `/05-design/phase-3-migrations/`. The two are unrelated — they live in separate folders and have distinct Supabase migration names (`phase_2_014_…` vs `phase_3_014_…`). No conflict.

## What each migration does

### `011_create_vector_extension.sql`

`CREATE EXTENSION IF NOT EXISTS vector;` plus a descriptive COMMENT. pgvector version `0.8.0` is the default available on this Supabase project.

### `012_create_memory_table.sql`

Creates `public.memory`:

- `id uuid pk default gen_random_uuid()`
- `namespace text not null`
- `content text not null`
- `embedding vector(1536)` — **nullable**, so `capture()` can write a row first and fill the embedding async
- `metadata jsonb not null default '{}'::jsonb`
- `source text`
- `source_id text`
- `created_at timestamptz not null default now()`

Indexes:
- `idx_memory_embedding_hnsw` — HNSW, `vector_cosine_ops`, default params (m=16, ef_construction=64)
- `idx_memory_namespace` — btree
- `idx_memory_created_at_desc` — btree desc
- `idx_memory_source_source_id` — btree composite
- `idx_memory_metadata_gin` — GIN on jsonb
- `uq_memory_source_source_id` — originally a **partial unique** on `(source, source_id) WHERE source_id IS NOT NULL`. **Replaced by migration 014** with a full unique index `memory_source_source_id_key` because PostgREST cannot express the `WHERE` predicate on `ON CONFLICT` upserts (42P10). NULLS DISTINCT default preserves the original semantics — multiple NULL source_id rows still coexist.

RLS enabled. `authenticated` SELECT policy; `service_role` bypasses by default.

### `014_fix_memory_unique_index.sql`

Drops the partial unique index `uq_memory_source_source_id` (created by 012) and replaces it with a full unique index `memory_source_source_id_key` on `(source, source_id)`.

**Why:** PostgreSQL requires the `ON CONFLICT` target to match a full unique index; PostgREST has no way to attach the `WHERE source_id IS NOT NULL` predicate to an upsert request. Every `?on_conflict=source,source_id` POST returned `42P10`. The migration script's attempt #3 lost all 134 upserts to this. With a full unique index PostgREST resolves the conflict target correctly. Postgres's default NULLS DISTINCT means multiple NULL source_id rows still coexist — the original idempotency semantics are preserved for rows that do have source_id set.

### `013_create_match_memory_rpc.sql`

`match_memory(query_embedding vector(1536), match_namespace text, match_count int DEFAULT 10, metadata_filter jsonb DEFAULT '{}'::jsonb)` returning `(id, content, metadata, similarity)`.

- Filters by namespace (required) and metadata containment (`@>`).
- Orders by cosine distance ascending.
- `similarity = 1 - cosine_distance` — higher is more similar (matches OB-1 / Pinecone semantics).
- `SECURITY INVOKER`, `search_path = public` (prevents schema-hijack).

## Verification (run after applying)

```sql
-- 1. Extension installed
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
-- expect: ('vector', '0.8.0')

-- 2. Table + all 7 indexes present, RLS on
SELECT indexname FROM pg_indexes WHERE tablename = 'memory' ORDER BY indexname;
-- expect (post-014): idx_memory_created_at_desc, idx_memory_embedding_hnsw,
--         idx_memory_metadata_gin, idx_memory_namespace,
--         idx_memory_source_source_id, memory_pkey, memory_source_source_id_key
-- (pre-014 the last was uq_memory_source_source_id — partial; 014 replaced it)
SELECT relrowsecurity FROM pg_class WHERE relname = 'memory';  -- true

-- 3. RPC callable with 1536-zero vector on empty table
SELECT * FROM public.match_memory(
    array_fill(0.0::real, ARRAY[1536])::vector,
    'knowledge',
    5,
    '{}'::jsonb
);
-- expect: 0 rows, no error
```

All three verified on 2026-04-17 immediately after apply.

## How to roll back

**Rollback is safe BEFORE data migration runs. After `/ops/scripts/migrate-pinecone-to-pgvector.ts` populates rows, a rollback drops the data.**

```sql
-- In reverse order:
DROP FUNCTION IF EXISTS public.match_memory(vector, text, int, jsonb);
DROP TABLE    IF EXISTS public.memory CASCADE;
DROP EXTENSION IF EXISTS vector;  -- only if no other tables use the vector type
```

`CASCADE` on the memory drop handles the RLS policy and all indexes. Safe on this project today because nothing else references `memory`.

## Conventions applied (from `../data-model.md`)

- `snake_case` everything.
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`.
- `created_at timestamptz NOT NULL DEFAULT now()`.
- RLS enabled on every new table. Default policy = `authenticated` SELECT; service_role bypasses; anon denied.
- Vector column: `embedding vector(N)`; HNSW with `vector_cosine_ops`.
- GIN on any JSONB we'll filter on.

## Sub-question resolutions (from the Q2 memo)

The Q2 memo listed 7 open sub-questions if option (c) was chosen. Confirmed during this phase:

1. **Embedding dimension: 1536** (text-embedding-3-small). OB-1 default, Supabase-docs default, cost-efficient. Locked into the column type.
2. **Truncate existing 3072 vectors or re-embed: re-embed.** We're deduping + normalizing metadata anyway; a clean run is easier to reason about. Script uses `text-embedding-3-small`.
3. **Schema: one `memory` table + `namespace` column.** Implemented. Per-domain split is a later call if access patterns diverge.
4. **Keep Pinecone during cutover: yes, dual-read 1–2 weeks.** Not part of Phase 2; enforced by Phase 2.5 Edge-Function rewrite + Phase 3 hard-cut.
5. **Drop 5 persona-memory namespaces:** confirmed. Migration script skips them and logs counts.
6. **HNSW parameters: defaults** (m=16, ef_construction=64). Revisit only if validation shows poor recall.
7. **Re-embed script location: `/ops/scripts/migrate-pinecone-to-pgvector.ts`.** One-shot, kept for reference.

## What's NOT in this phase (deliberately)

- **Running** the data migration. `/ops/scripts/migrate-pinecone-to-pgvector.ts` is built but gated on Edmund's approval of the dry-run output.
- Updating Edge Functions / Skills that call `search_memory` (Pinecone) to call `match_memory()` (Phase 2.5).
- Decommissioning the Pinecone `gravity-claw` index (separate phase after dual-read cutover).
- Any `user_id`-scoped RLS tightening (deferred until multi-tenant becomes real — see Phase 1 README open question #4).

## Cross-reference

- Execution log (this phase's running notes, open sub-questions, gotchas): `../../06-handoffs/2026-04-17-phase-2-execution-log.md`
- Re-embed script: `/ops/scripts/migrate-pinecone-to-pgvector.ts`
