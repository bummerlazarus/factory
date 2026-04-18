# Phase 2 execution log — pgvector consolidation

**Date:** 2026-04-17
**Session:** Phase 2 build-only (no data migration). Runs in parallel with Phase 3 — do NOT touch `/dashboard/`, `/skills/`, `/agents/`, or `03-decisions/decisions-log.md`.
**Scope:** Schema + RPC + migration script. Dry-run only; Edmund approves before data writes.

## What landed

| # | Artifact | Status |
|---|---|---|
| 1 | Supabase migration `phase_2_011_create_vector_extension` — `CREATE EXTENSION IF NOT EXISTS vector;` | Applied |
| 2 | Supabase migration `phase_2_012_create_memory_table` — `public.memory` + 7 indexes (HNSW, btree×3, GIN, unique partial, pkey) + RLS | Applied |
| 3 | Supabase migration `phase_2_013_create_match_memory_rpc` — `match_memory(vector, text, int, jsonb)` | Applied |
| 4 | SQL copies + README at `05-design/phase-2-migrations/` | Written |
| 5 | Deno migration script at `/ops/scripts/migrate-pinecone-to-pgvector.ts` | Written + `deno check` passes |
| 6 | Dry-run report at `/ops/scripts/migration-report.md` | Written |

## Verification — all pass

- `SELECT * FROM pg_extension WHERE extname='vector';` → `vector 0.8.0` (one row)
- `SELECT indexname FROM pg_indexes WHERE tablename='memory';` → all 7 expected indexes present (`idx_memory_embedding_hnsw`, `idx_memory_namespace`, `idx_memory_created_at_desc`, `idx_memory_source_source_id`, `idx_memory_metadata_gin`, `uq_memory_source_source_id`, `memory_pkey`)
- `SELECT relrowsecurity FROM pg_class WHERE relname='memory';` → `true`
- `SELECT * FROM public.match_memory(array_fill(0.0::real, ARRAY[1536])::vector, 'knowledge', 5, '{}'::jsonb);` → 0 rows, no error
- `deno check migrate-pinecone-to-pgvector.ts` → clean
- Dry run against live Pinecone → totals match audit (14,491)

## Dry-run per-namespace results

| Namespace | Action | Pinecone | Deduped | To upsert |
|---|---|---:|---:|---:|
| `knowledge` | migrate | 14,050 | 1,265 | 12,785 |
| `conversations` | migrate | 211 | 10 | 201 |
| `content` | migrate | 209 | 3 | 206 |
| `cordis-memory` | drop | 10 | — | — |
| `ceo-memory` | drop | 4 | — | — |
| `developer-memory` | drop | 3 | — | — |
| `marketing-memory` | drop | 2 | — | — |
| `content-memory` | drop | 2 | — | — |
| **Total** | | **14,491** | **1,278** | **13,192** |

Deduplication (by SHA-256 of `content`) caught ~3× more duplicates than the audit's "~400 Priestley chunks" estimate — real number is **1,278 dupes across knowledge/conversations/content** (~8.8% of the corpus). Good news for the re-embedding bill.

## Sub-question resolutions (Q2 memo)

Memo leanings confirmed; no deviations.

| Sub-question | Memo leaning | Status |
|---|---|---|
| #1 Dimension | 1536 (`text-embedding-3-small`) | Confirmed — locked into column type |
| #2 Truncate vs re-embed | Re-embed | Confirmed — script re-embeds from `metadata.text` |
| #3 One table vs per-domain | One `memory` + `namespace` | Confirmed |
| #4 Dual-read during cutover | Yes, 1–2 weeks | Out of Phase 2 scope; handled in Phase 2.5 |
| #5 Drop persona-memory namespaces | Drop (21 vectors across 5 namespaces) | Confirmed — script logs counts, skips writes |
| #6 HNSW params | Defaults (m=16, ef_construction=64) | Confirmed — pgvector defaults used |
| #7 Script location | `/ops/scripts/migrate-pinecone-to-pgvector.ts` | Confirmed |

## Gotchas surfaced during build

1. **Pinecone `/vectors/fetch` GET hits HTTP 431 at 100 ids/call.** Initial fetch batch of 100 failed on `knowledge` with "Request Header Fields Too Large" — too many `?ids=` query params. Reduced `PINECONE_FETCH_BATCH` to **25**. Knowledge now fully fetched (14,050 ids in ~562 calls). If the real run wants to be faster, switch to POST `/vectors/fetch` with JSON body in API version `2025-01`; sticking with GET+25 for the one-shot since latency is fine.
2. **Retry policy.** Added 3× retry with exponential backoff on Pinecone fetch for 429 / 5xx. 431 and other 4xx fail fast (deterministic).
3. **`OPENAI_API_KEY` is not in `ops/.env` today.** Edmund uses OpenRouter for LLMs but needs a direct OpenAI key (or OpenRouter embedding equivalent) for `text-embedding-3-small`. Script refuses `--execute` without it; dry-run skips the auth ping. See "Env vars to add" below.
4. **Upsert conflict target.** Used `on_conflict=source,source_id` which matches the partial unique index `uq_memory_source_source_id WHERE source_id IS NOT NULL`. All migrated rows have source_id (Pinecone vector id), so the partial constraint is always satisfied during migration. `capture()` in Phase 3 needs to be aware that anonymous rows (source_id NULL) won't dedup.
5. **`pinecone_id` + `pinecone_namespace` preserved in metadata.** Lets us reconcile during the dual-read phase and audit any content drift.
6. **`ingest_date_known: false` stamped on every migrated row.** Explicit marker that these are historical rows with no known ingest date (audit flagged this gap). New Edge-Function rows will set `ingest_date_known: true` plus a timestamp, or just rely on `created_at`.

## Env vars Edmund needs to set before `--execute`

Already in `ops/.env`:
- `PINECONE_API_KEY` ✓
- `PINECONE_INDEX_NAME=gravity-claw` ✓
- `SUPABASE_URL` ✓
- `SUPABASE_SERVICE_ROLE_KEY` ✓

**Missing — add before real run:**
- `OPENAI_API_KEY` — direct OpenAI key for `text-embedding-3-small`. OpenRouter does not proxy OpenAI embeddings; if preferred, the script can be swapped to call an OpenAI-compatible embedding provider, but 1536-dim `text-embedding-3-small` is the cheapest/simplest path.

## Cost + time estimate for real `--execute`

**Embedding cost (`text-embedding-3-small` @ $0.02 / 1M tokens):**
- 13,192 rows × ~500 tokens avg content ≈ 6.6M tokens
- Cost: **≈ $0.13** one-time. Book chunks run longer; budget ≤ $0.30 worst case.

**Runtime:**
- OpenAI embeddings: ~132 batches × ~3 s = ~6–7 min
- Pinecone fetch: ~562 batches × ~0.3 s = ~3 min (already observed in dry run)
- Supabase upsert (100-row batches): ~132 batches × ~0.5 s = ~1 min (+ HNSW index maintenance, negligible at 14K)
- **Total wall clock: ~10–15 min** for the full run

## What's NOT done (out of scope for Phase 2)

- **Running** the data migration (gated on Edmund's approval).
- Rewriting Edge Functions / Skills that call Pinecone `search_memory` to call `match_memory()` — **Phase 2.5**.
- Dual-read instrumentation (log diffs between Pinecone and pgvector during cutover) — **Phase 2.5**.
- Decommissioning the Pinecone `gravity-claw` index — separate phase after dual-read proves parity.

## How to actually run the migration (for Edmund)

```bash
# 1. Add OPENAI_API_KEY to ops/.env
echo 'OPENAI_API_KEY=sk-...' >> /Users/edmundmitchell/factory/ops/.env

# 2. Sanity check the script (optional, already passes)
cd /Users/edmundmitchell/factory/ops/scripts
deno check migrate-pinecone-to-pgvector.ts

# 3. Dry run one namespace for a final sniff test
deno run --env-file=../.env --allow-env --allow-net --allow-read --allow-write \
  migrate-pinecone-to-pgvector.ts --dry-run --namespace=content

# 4. Real run, all namespaces
deno run --env-file=../.env --allow-env --allow-net --allow-read --allow-write \
  migrate-pinecone-to-pgvector.ts --execute

# 5. Verify in Supabase
# SELECT namespace, count(*) FROM public.memory GROUP BY 1 ORDER BY 2 DESC;
#   expect: knowledge ~12785, content ~206, conversations ~201
```

If the run fails partway, re-running `--execute` is safe — idempotent on `(source, source_id)` via the partial unique index.

## 2026-04-17 — Real-run attempt #1 — BLOCKED on OpenAI billing

**Status:** Aborted before any embeddings or writes. `public.memory` row count = 0 (unchanged).

**What happened.** Edmund added `OPENAI_API_KEY` (164 chars, `sk-proj-…`) to `ops/.env` and approved the real run. Kicked off:
```
cd /Users/edmundmitchell/factory/ops/scripts
deno run --env-file=../.env --allow-env --allow-net --allow-read --allow-write \
  migrate-pinecone-to-pgvector.ts --execute
```
Script reached the pre-flight OpenAI auth/dimension check and failed at `POST /v1/embeddings` with **HTTP 429 / `insufficient_quota`**. Zero rows fetched from Pinecone, zero writes to Supabase. Script exited non-zero before the migration loop.

Direct `curl` against the same key reproduced the same 429 / `insufficient_quota`, confirming the key authenticates but the OpenAI account has no billing credit available. Not a code issue, not a key format issue — billing.

**Wall clock:** ~3 s (pre-flight only). **OpenAI spend:** $0.00 (429 = no billable call). **Pinecone calls:** 1 (describe_index_stats). **Supabase writes:** 0.

**Unblock.** Edmund needs to either (a) add a payment method / credits to the OpenAI project this key belongs to, or (b) swap in a different OpenAI API key whose project has quota. Once done, re-run the same command — the script is idempotent and `public.memory` is empty, so there's nothing to undo.

**No other surprises.** Pinecone stats ping returned the expected 14,491 vectors across 8 namespaces; index host + dim (3072) + metric (cosine) all match the audit. Re-embedding to 1536-dim is still the plan.

## 2026-04-17 — Real-run attempt #2 — DIED SILENTLY (no exit code, no stderr)

**Status:** Killed mid-fetch on `knowledge`. `public.memory` row count still 0. No partial writes (process died before any embed/upsert).

**What happened.** After OpenAI billing was unblocked, the real run was relaunched as a backgrounded bash job. The script passed pre-flight (OpenAI auth ok, dim=1536), started fetching `knowledge` (14,050 vectors), logged `[fetch] knowledge: listed 14050 ids`, then produced no further output for ~6 minutes. `pgrep -fa deno` → nothing. Log at `/tmp/phase2-attempt2.log` was 400 bytes, truncated right after id-listing.

**Root cause (most likely).** The deno process was orphaned / SIGHUP'd when its parent shell (the Claude Code harness's background-bash) closed. No code bug — script reached the fetch loop fine. Contributing factor: the fetch loop had **zero progress logging** (562 Pinecone calls with no output), so we couldn't tell "stuck" from "silently killed."

**Ruled out.**
- Pinecone 431 — `PINECONE_FETCH_BATCH=25` is in the code (line 65) and the first attempt with 100 already failed on 431 during the original dry-run, proving the 25-batch path works.
- Dimension mismatch — pre-flight `openai ok (dim=1536)` confirms.
- OpenAI quota — would have failed pre-flight like attempt #1. It passed.
- OOM — RSS was ~100MB at last sample; macOS wouldn't OOM-kill at that size.
- Unhandled rejection — would have produced a `FATAL:` line via the top-level `.catch`. Log had none.
- Deno permission — same flags as attempt #1; dry-run worked end-to-end.

**Fix applied.**
1. Added per-loop progress logging (`[fetch-progress]`, `[embed-progress]`, `[upsert-progress]`) every 500/500/1000 rows respectively, so future deaths are observable.
2. Relaunched with `nohup deno … > /tmp/phase2-attempt3.log 2>&1 < /dev/null & disown`, which reparents the child to PID 1 (init) and survives harness shell teardown. Verified PPID=1 post-launch.

**Attempt #3 status (live):** PID 70399, PPID=1, log at `/tmp/phase2-attempt3.log`. Fetch progressing at ~77 vectors/s (1000/14050 in 12.9s). Expected total wall clock ~10–15 min per the Phase 2 estimate.

## Links

- Decisions log entry (2026-04-17 Q2): `../03-decisions/decisions-log.md`
- Q2 memo: `../04-audit/2026-04-17-q2-vector-strategy-memo.md`
- Pinecone audit: `../04-audit/2026-04-17-pinecone-audit.md`
- Data model sketch: `../05-design/data-model.md`
- Phase 2 migrations + README: `../05-design/phase-2-migrations/`
- Migration script + dry-run report: `/ops/scripts/`
