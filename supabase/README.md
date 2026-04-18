# /supabase

One of the six target-repo folders (per `01-context/principles.md`). Holds everything that runs inside the Supabase project:

- `migrations/` — canonical SQL migrations. Each file applied via Supabase MCP `apply_migration`. Naming: `NNN_description.sql` (global sequence, matches the migration name applied to the project).
- `functions/` — Edge Functions + shared modules.
  - `functions/_shared/` — modules imported by multiple Edge Functions. Not deployable on its own.
  - `functions/<name>/index.ts` — deployable Edge Function entry points (Deno runtime).

## Conventions

- **Dimension:** all pgvector embeddings are 1536-dim (`text-embedding-3-small`).
- **Namespaces:** `knowledge`, `conversations`, `content`. Persona namespaces are not used — persona memory lives in `agent_core_memory` / `agent_scratchpad`.
- **Idempotency:** every write path uses `(source, source_id)` for upsert conflict resolution.
- **RLS:** enabled on every table. `service_role` bypasses. `authenticated` gets narrow policies.
- **Migration cadence:** additive migrations (`CREATE`, `ADD COLUMN`, new indexes) can be applied without Edmund's explicit per-epic approval (see `../architecture rebuild 2026-04-17/06-handoffs/autonomy-charter.md`). Destructive migrations require approval.

## Current Edge Functions

_None yet deployed to Supabase — the project has zero Edge Functions as of 2026-04-17._

Planned (see `../architecture rebuild 2026-04-17/06-handoffs/backlog.md`):
- `capture` — W2.1
- `ingest-youtube` — W4.4
- `ingest-signals` — W4.5
- `sync-youtube-comments`, `publish-instagram-*`, `generate-voice`, `generate-pdf` — later waves

## Shared modules

- `functions/_shared/dualread.ts` — dual-read helper for the Pinecone → pgvector cutover window. See module docstring.

## Semantic search convention

All semantic-search callers (Edge Functions, Skills, one-off scripts, dashboard API routes) call the `match_memory()` Postgres RPC. Never reach into the `memory` table directly for retrieval; the RPC owns namespace filtering, metadata containment, and similarity ordering, and will evolve as the retrieval story evolves.

- **From supabase-js:** `supabase.rpc("match_memory", { query_embedding, match_namespace, match_count, metadata_filter })`
- **From the dashboard API:** same pattern, through the service-role client at `lib/supabase.ts`.
- **From a caller that also wants to log parity vs. Pinecone during cutover:** use `functions/_shared/dualread.ts` instead; it returns the same pgvector result shape and logs a side-by-side comparison to `memory_dualread_log`.

Audit status (2026-04-17): the factory codebase has zero runtime semantic-search callers today — dashboard doesn't search, `capture()` only writes. Historical callers live in the retiring GravityClaw MCP (`/Users/edmundmitchell/gravityclaw/`); those stay in place until W9.4 decommission.
