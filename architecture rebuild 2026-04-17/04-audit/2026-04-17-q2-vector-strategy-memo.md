# Q2 Vector Strategy — Decision Memo

**Date:** 2026-04-17
**Status:** For decision. Options laid out; Edmund picks.
**Inputs:** Pinecone audit, OB-1 review, rewire synthesis, data-model sketch, principles, stack.

---

## TL;DR + Recommendation

**Recommendation: (c) Consolidate to pgvector inside Supabase.** The corpus is small (14,491 vectors), filters are trivially single-field, Pinecone MCP doesn't work on the current BYO index anyway, and principles.md explicitly says "architect so consolidation to pgvector is a swap, not a rewrite." Doing the swap now — while volume is small and before new Edge Functions start double-writing to two stores — is cheaper than doing it later. It collapses semantic search into the same Postgres that holds the source of truth, kills a vendor line item, and removes the Pinecone integrated-vs-BYO question entirely. Secondary: (b) BYO Pinecone via SDK is a safe fallback if pgvector benchmarks disappoint at 3072-dim.

---

## Current-state snapshot (from Pinecone audit)

- **1 index** — `gravity-claw`, serverless AWS us-east-1
- **14,491 vectors**, **3072-dim**, cosine, **bring-your-own** (OpenAI `text-embedding-3-large`)
- **8 namespaces** — `knowledge` (14,050) dominates; `conversations` (211), `content` (209), five persona-memory namespaces (2–10 each)
- **Filters used in production:** single-field only (`source`, `channel_name`, `persona_id`). No hybrid/multi-field. JSONB `@>` or plain `WHERE` replicates everything.
- **Pinecone MCP data-plane tools don't work on this index** — they require integrated indexes. Today GravityClaw uses the Python SDK.
- **Spend:** Low (serverless, ~15K vectors — well under the $10–20/mo floor for this scale).
- **Known hygiene issues:** ~400 duplicate Priestley chunks, inconsistent metadata schemas across ingest types, no `ingest_date` anywhere. Any migration is also a cleanup opportunity.

---

## Decision criteria (derived from principles.md + stack.md)

1. **Don't outbuild Anthropic / minimize surface** — fewer vendors, fewer MCPs, fewer keys.
2. **Velocity** — Edmund values time over money; pick what unblocks Tier 1/2 rewire fastest.
3. **Reliability** — source of truth lives in Supabase; vectors drifting from rows is a known failure mode.
4. **Lock-in / replaceability** — "architect so consolidation to pgvector is a swap, not a rewrite."
5. **Migration cost** — one-time effort + re-embedding $.
6. **Cost at steady state** — monthly spend + per-query overhead.
7. **DevX** — one SQL query vs. two-system dance from Edge Functions.

---

## Options

### (a) Migrate to Pinecone integrated index

**Concretely:** Create a new index with a Pinecone-hosted model (`llama-text-embed-v2` or `multilingual-e5-large`, both 1024-dim). Re-embed all 14,491 vectors by upserting text. Retire the BYO index. Pinecone MCP `upsert-records` / `search-records` now work from Claude directly.

- **Migration effort:** Moderate. Re-export text from BYO index (texts are stored in metadata — possible), re-upsert via MCP/CLI. ~4–6 hours incl. namespace mapping + dedup pass.
- **Cost:** Similar to today at this volume, but Pinecone billing now includes hosted embedding tokens per query.
- **DevX:** Best of the Pinecone options — native MCP calls from Claude; no SDK code required for read path.
- **Lock-in:** Worst. Embedding model is now Pinecone-proprietary; can't move to Supabase/OpenRouter without re-embedding again.
- **Criteria scoring:** wins DevX; loses lock-in + "don't outbuild" (still two vendors); neutral on velocity (migration is the same size as c).

### (b) Keep BYO Pinecone, call via SDK from Edge Functions

**Concretely:** Leave `gravity-claw` alone. All semantic search goes through an Edge Function that wraps the Pinecone SDK. Pinecone MCP stays available for metadata ops only (`describe-index-stats`, etc.). This is what the rewire synthesis leans toward.

- **Migration effort:** Near zero on the data side. Cost is wrapping the SDK in an Edge Function (~2 h) and updating any Skills that called `search_memory` to call the Edge Function instead.
- **Cost:** Same as today. Plus Edge Function invocations (negligible).
- **DevX:** Worse than (a) or (c). Every semantic call is Claude → MCP/Edge Function → Pinecone SDK → Postgres dual-lookup to hydrate rows. Two systems to reason about per query.
- **Lock-in:** Low-to-medium. Embeddings are portable (OpenAI). Can migrate later.
- **Criteria scoring:** wins velocity short-term (zero migration); loses on reliability (two sources of truth to keep in sync as `capture_thought` fires); loses "don't outbuild" (keep the Pinecone vendor line). The `knowledge` namespace is large enough that this works fine at this scale.

### (c) Consolidate to pgvector inside Supabase *(recommended)*

**Concretely:** `CREATE EXTENSION vector;` on Supabase. Create `memory` table per `05-design/data-model.md` sketch with `namespace`, `content`, `embedding vector(N)`, `metadata jsonb`. HNSW index. `match_memory()` RPC for search. Re-embed the 14,491 vectors (fresh embedding run during migration — or keep 3072 if we keep OpenAI large). Retire Pinecone.

- **Migration effort:** ~8–12 hours. Steps: (1) extract text + metadata from Pinecone (Python script, one afternoon); (2) dedup Priestley chunks + normalize metadata; (3) re-embed via OpenAI or OpenRouter ($1–5 one-time); (4) bulk upsert into `memory`; (5) build `match_memory` RPC; (6) rewrite Skills that called `search_memory` to call the RPC via Supabase MCP. Migration is scriptable and reversible (Pinecone index can stay up during cutover as a read replica).
- **Cost:** $0 incremental (Supabase project already paid). Save whatever Pinecone serverless costs today. Embedding cost is paid per-ingest, same as today.
- **DevX:** Best. Semantic search is just `SELECT ... ORDER BY embedding <=> query_embedding LIMIT k` filtered by `metadata @> '{...}'`. One system. JOINs against source-of-truth tables work. Supabase MCP already wired.
- **Lock-in:** Lowest. Postgres + pgvector is the most portable combination in the stack.
- **Reliability:** Best. Vectors and rows share transactional boundary; no drift window.
- **Criteria scoring:** wins "don't outbuild," reliability, DevX, lock-in. Loses velocity to (b) by ~8 hours. At 14K vectors, pgvector HNSW recall/latency is well within acceptable (sub-50ms typical). If corpus grows past ~500K, revisit.

### (d) File-based (rg/grep over Skills + reference docs)

**Concretely:** No vector DB. Skills and reference markdown searched via `rg`. For the `knowledge` corpus (books, transcripts), this means re-ingesting as markdown files and accepting lexical-only search.

- **Migration effort:** Moderate-but-pointless for the 14K vectors. Would lose semantic recall on transcripts/books where users don't know exact words.
- **Fitness:** Works for Skills/SOPs (Q2 already resolved this informally — file-based is fine for the *Skills* corpus). Does **not** work for the 14K archival corpus. Open-questions.md explicitly rules this out for the corpus.
- **Verdict:** Use file-based for Skills; use a vector store for the corpus. Not a standalone answer to Q2.

---

## Tradeoff table

| Criterion | (a) Pinecone integrated | (b) Pinecone BYO + SDK | (c) pgvector | (d) File-based |
|---|---|---|---|---|
| Don't outbuild / fewer vendors | 2 vendors | 2 vendors | **1 vendor** | 1 vendor |
| Velocity (to working state) | 4–6 h | **~2 h** | 8–12 h | N/A (doesn't solve) |
| Reliability (single SoT) | drift risk | drift risk | **unified** | N/A |
| Lock-in | **high** (proprietary embed) | low-med | **lowest** | none |
| Migration cost | moderate | **~zero** | moderate | moderate + lossy |
| Steady-state cost | ~same + embed tokens | ~same | **$0 incremental** | $0 |
| DevX | native MCP | two-system | **one SQL** | grep |
| Handles 14K corpus | yes | yes | yes | no |
| Principle fit ("swap, not rewrite") | worst | neutral | **best** | partial |

Legend: **bold** = best in row.

---

## Recommendation + rationale

**Pick (c) pgvector.** Three things drive it:

1. **Principles.md already pre-committed to this.** "Architect so consolidation to pgvector is a swap, not a rewrite." The rewire is exactly the moment to do the swap — before new Edge Functions (`capture_thought`, YouTube ingest, signals ingest) start writing to two stores and making the swap expensive. Locking in Pinecone now through option (a) or (b) means paying for the migration later when it's 10× the data.
2. **The corpus is small and the filters are trivial.** 14K vectors with single-field filters is pgvector's sweet spot. HNSW at this scale gives sub-50ms search with recall indistinguishable from Pinecone. There's no scale or query-complexity argument for keeping Pinecone.
3. **One source of truth beats two.** Every Tier-2 Edge Function in the rewire synthesis currently has to dual-write (Supabase row + Pinecone vector). Collapsing that into a single `INSERT INTO memory` inside the same transaction as the row write removes an entire class of drift bugs. The rewire synthesis acknowledged this risk; pgvector eliminates it.

**What would change my answer:**
- **If the corpus was 500K+ vectors** or growing fast toward that, pgvector's rebuild-during-bulk-insert overhead becomes real and Pinecone's serverless elasticity starts to matter. Not the case today.
- **If Edmund planned to offer vector search to third-party clients** (multi-tenant SaaS), Pinecone's isolation model + metrics are better out of the box. He doesn't.
- **If benchmarks on his actual query mix showed pgvector latency > 200ms p95** on the real `knowledge` namespace, (b) becomes the safe fallback. Should be part of the migration validation step.

The rewire synthesis leaned (b) only because it had not yet absorbed that the BYO index means Pinecone MCP is half-useless anyway — which removes Pinecone's main remaining advantage (native tool calls). Once that advantage goes, (c) wins on every other axis.

---

## Open sub-questions if (c) is chosen

1. **Embedding dimension: 1536 or 3072?** `text-embedding-3-large` at 3072 is what's in Pinecone today. `text-embedding-3-small` at 1536 is ~5× cheaper per token and HNSW indexes are ~2× smaller/faster. For 14K vectors the cost difference is noise, but the re-embedding one-time run matters. **Recommendation: 1536 (text-embedding-3-small)**. It's the OB-1 choice, the Supabase docs examples all use 1536, and recall difference on this corpus will be inside the noise.
2. **Truncate existing 3072 embeddings or re-embed?** OpenAI supports MRL truncation of `text-embedding-3-large` down to 1536, saving the re-embed call. Worth doing if we want to preserve current semantics exactly; re-embed with `-small` if we want the speed/cost win. **Probably re-embed** — we're also deduping and normalizing metadata, so a clean run is easier to reason about.
3. **Schema: one `memory` table with `namespace`, or per-domain tables?** OB-1 uses one `thoughts` table. Data-model.md sketch uses one `memory` table. Per-domain would be tidier (`yt_chunks`, `book_chunks`, `thoughts`, `competitor_content`) but more tables to maintain. **Recommendation: start with one `memory` table + `namespace` column**; split later only if a specific domain develops different access patterns.
4. **Keep Pinecone during cutover, or hard cut?** Recommend **dual-read** for 1–2 weeks — search both, log diffs, then kill Pinecone. Low effort, catches missed records.
5. **What to do with the 5 persona-memory namespaces?** Audit flagged they're ephemeral by design. **Recommendation: drop them.** Rebuild persona memory inside `agent_core_memory` / `agent_scratchpad` tables (non-vector). They're 2–10 rows each; nothing to migrate.
6. **HNSW parameters.** Defaults (`m=16`, `ef_construction=64`) are fine at 14K. Revisit only if recall is poor in validation.
7. **Where does the re-embed script live?** Per repo discipline: `/ops/scripts/migrate-pinecone-to-pgvector.ts`. One-shot, keep for reference after.

---

*If Edmund wants the 2-hour path instead: pick (b), wrap Pinecone SDK in an Edge Function, move on with the rewire, and revisit pgvector migration as a Phase 6 item. That's defensible — just understand it kicks the "swap, not rewrite" principle down the road while the corpus grows.*
