# Run log — W4.5 signals-ingest Edge Function port

**Date:** 2026-04-17
**Epic:** W4.5 — Port `tools/ingest_signals.py` from GravityClaw to Supabase Edge Function
**Plan file:** [2026-04-17-w4-5-signals-ingest.md](../../05-design/plans/2026-04-17-w4-5-signals-ingest.md)
**Status:** 🟢 DONE

## Files touched

| File | Change |
|---|---|
| `dashboard/supabase/functions/signals-ingest/index.ts` | **New** — 479-line Edge Function (~350 LOC logic + comments). Auth, validation, MD5 dedup, Gemini summarize, OpenAI embed, `signals` + `memory` + `signal_source_health` writes. |
| `dashboard/supabase/functions/signals-ingest/README.md` | **New** — contract, request/response shapes, secrets, smoke-test curl. |
| `architecture-rebuild-2026-04-17/05-design/plans/2026-04-17-w4-5-signals-ingest.md` | **New** — plan doc with bug explanation, API, acceptance criteria, open questions. |
| `architecture-rebuild-2026-04-17/06-handoffs/backlog.md` | W4.5 status ⚪ → 🟢 (this run). |

No changes under `dashboard/app/`, `dashboard/lib/`, `dashboard/components/`, or `capture/` — scope bounds respected.

## Supabase migrations applied

**None.** Schema inspected via `execute_sql` on `information_schema.columns` — the existing `signals` (15 cols), `signal_source_health` (6 cols), and `memory` (8 cols, pgvector embedding) tables fit every write the Python ingest performed. No `ADD COLUMN` needed.

## Subagents dispatched

None. Scope was tight enough to execute inline.

## Faithful Python behavior (summary)

- Read sources JSON → for each source with `last_checked_at < 16h` skip → fetch entries (yt-dlp for YouTube, feedparser for RSS, top-2 items) → `md5(link)` PK dedup → Gemini 2.5 Flash curator prompt → normalize 1-10 score to 0-100 → `signals.insert` → if score ≥ 60: Pinecone `upsert_knowledge(namespace="signals")` → aggregate + upsert `signal_source_health`.

## The "missing namespace" bug

Two coupled issues, both fixed:

1. **Wrong namespace.** Python wrote high-score embeddings to Pinecone `namespace="signals"`, but the factory's canonical pgvector `memory` table only indexes `knowledge` (12,787 rows), `content` (208), `conversations` (201). Nothing reads from `"signals"` — those Pinecone rows were invisible to `match_memory()` and to any pgvector-based retrieval in the rebuild.
2. **Score gate orphaned low-relevancy rows.** The `score >= 60` threshold meant ~half the ingested signals never got embedded at all, so they could never be surfaced even if the namespace were right.

**Fix (deployed):** every signal is now embedded (1536-dim `text-embedding-3-small`) and written to `public.memory` with `namespace='knowledge'`, `source='signal'`, `source_id=signals.id`. Score lives on `signals.relevancy_score` and `memory.metadata.relevancy_score` so downstream callers can threshold. Best-effort: missing `OPENAI_API_KEY` → `memory_warning` + signal row still inserts (matches `capture()` policy).

## Deploy

```
mcp__supabase__deploy_edge_function(
  project_id="obizmgugsqirmnjpirnh",
  name="signals-ingest",
  entrypoint_path="index.ts",
  verify_jwt=false,
  files=[{name:"index.ts", content:<479 lines>}],
)
→ version 1, status=ACTIVE, verify_jwt=false, sha256=fd17f7536fa0d48…
```

First deploy, no retries, no auth issues.

## Verification

### Test 1 — fresh POST (2 items)

```
$ curl -sS -X POST https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/signals-ingest \
    -H "x-capture-secret: $CAPTURE_SECRET" -H "content-type: application/json" \
    -d '{"source":{"name":"W4.5 Smoke Test","url":"https://example.com","category":"test","brand_arm":"em","content_type":"article","priority":"low","watch_for":"smoke test for W4.5 signals-ingest edge function"},"items":[{"title":"Hello signals (item A) 1776450870","link":"https://example.com/w45-smoke-a-1776450870","description":"First smoke-test entry…"},{"title":"Hello signals (item B) 1776450870","link":"https://example.com/w45-smoke-b-1776450870","description":"Second smoke-test entry.","published_at":"2026-04-15T12:00:00Z"}]}'
```

Response (verbatim):
```json
{
    "source_name": "W4.5 Smoke Test",
    "processed": 2,
    "inserted": 2,
    "skipped": 0,
    "errors": 0,
    "results": [
        {
            "id": "c96c9deb3dba8c4657c786f7ce5a3d91",
            "title": "Hello signals (item A) 1776450870",
            "status": "inserted",
            "relevancy_score": 50,
            "memory_id": "1f1e6bee-6be2-41b2-a33d-0d0f75adb351",
            "memory_warning": null,
            "summary_warning": "GOOGLE_API_KEY not set; skipped summary"
        },
        {
            "id": "bbc308cf670bd395a4824435ecd999ed",
            "title": "Hello signals (item B) 1776450870",
            "status": "inserted",
            "relevancy_score": 50,
            "memory_id": "d353480d-9373-4cab-9057-1cf95e23e3a1",
            "memory_warning": null,
            "summary_warning": "GOOGLE_API_KEY not set; skipped summary"
        }
    ],
    "source_health": {
        "source_name": "W4.5 Smoke Test",
        "last_checked_at": "2026-04-17T18:34:40.990Z",
        "signals_count": 2,
        "avg_relevancy": 50,
        "last_error": null,
        "updated_at": "2026-04-17T18:34:40.990Z"
    }
}
```

### Test 2 — re-POST same links (dedup check)

```json
{
    "source_name": "W4.5 Smoke Test",
    "processed": 2,
    "inserted": 0,
    "skipped": 2,
    "errors": 0,
    "results": [
        {"id":"c96c9deb3dba8c4657c786f7ce5a3d91","title":"Hello signals (item A) 1776450870","status":"skipped"},
        {"id":"bbc308cf670bd395a4824435ecd999ed","title":"Hello signals (item B) 1776450870","status":"skipped"}
    ],
    "source_health": {"source_name":"W4.5 Smoke Test","last_checked_at":"2026-04-17T18:35:03.274Z","signals_count":2,"avg_relevancy":50,"last_error":null,"updated_at":"2026-04-17T18:35:03.274Z"}
}
```

### Test 3 — DB state (SQL via Supabase MCP)

```sql
SELECT
  (SELECT count(*) FROM public.signals WHERE source_name='W4.5 Smoke Test') AS signals_rows,
  (SELECT count(*) FROM public.memory WHERE source='signal' AND source_id IN ('c96c9deb3dba8c4657c786f7ce5a3d91','bbc308cf670bd395a4824435ecd999ed')) AS memory_rows,
  (SELECT count(*) FROM public.memory WHERE source='signal' AND namespace='knowledge') AS all_signal_knowledge_rows;
```

Result:
```
signals_rows=2, memory_rows=2, all_signal_knowledge_rows=2
```

Per-row memory dump:
```
id=1f1e6bee-… namespace=knowledge source=signal source_id=c96c9deb… content_len=68 has_embedding=true md_source_name="W4.5 Smoke Test" md_score="50"
id=d353480d-… namespace=knowledge source=signal source_id=bbc308cf… content_len=68 has_embedding=true md_source_name="W4.5 Smoke Test" md_score="50"
```

### Acceptance criteria

| # | Check | Result |
|---|---|---|
| 1 | `processed = inserted + skipped + errors` on 2-item POST | ✓ 2 = 2+0+0 |
| 2 | `signals` rows match `results[*].id` with correct columns + `relevancy_score` 0-100 | ✓ |
| 3 | `memory` rows with `source='signal'`, `namespace='knowledge'`, count == `inserted` | ✓ 2 rows |
| 4 | `signal_source_health` upserted with count + avg | ✓ `signals_count=2, avg_relevancy=50` |
| 5 | Re-POST same body → `inserted:0, skipped:2`, no duplicates | ✓ |

## Decisions made this run

1. **Namespace = `'knowledge'`** — matches `capture()` text-kind precedent and actually routes through `match_memory()`. Fixes bug (1) above.
2. **Embed every signal (no score gate)** — fixes bug (2). Downstream threshold still works via `memory.metadata.relevancy_score`.
3. **Two-phase (caller fetches RSS / yt-dlp)** — same rationale as W4.4. Deno can't run `feedparser` or `yt-dlp`; those are commodity and belong outside the Edge Function. Edge Function body signature is `{source, items, force?}`.
4. **No migration.** Schema inspected and confirmed sufficient. No `ADD COLUMN` or `CREATE`.
5. **MD5 via `jsr:@std/crypto`** — parity with Python's `hashlib.md5` so a side-by-side run of the old Python ingest and the new Edge Function would dedupe against each other during any transition. Hex encoding via `jsr:@std/encoding/hex`.
6. **Gemini via direct HTTPS** — no SDK, consistent with the "no new deps" pattern.

## Follow-ups flagged

1. **`GOOGLE_API_KEY` not set in function secrets.** Verification ran fine with the fallback (`summary = title`, `score = 50`, `summary_warning` returned), so the best-effort policy held. Edmund should add it when he wants live Gemini scoring — no code change needed, just:
   ```
   npx supabase secrets set GOOGLE_API_KEY=... --project-ref obizmgugsqirmnjpirnh
   ```
2. **No companion RSS/yt-dlp fetcher shipped.** The Edge Function needs a caller that fetches and POSTs `items[]`. Options when Edmund wants the full loop:
   - Port the `feedparser` + `yt-dlp` half to a local Node/Deno script (`ops/scripts/ingest-signals.ts`) and run via cron or scheduled task — mirrors the W4.4 plan's "companion script" pattern.
   - Build an MCP tool `ingest-signals` that Cordis can call from chat with hand-curated items.
   - Temporarily leave GravityClaw's Python signals job running as a feeder that POSTs here instead of writing directly to Supabase.

   Not in this run's scope. New backlog epic if Edmund wants full automation; current state already fixes the namespace bug and unblocks new writes going through the right pipe.
3. **`signal_sources.json`** is not yet ported. Either promote to a new `signal_sources` table or ship it as a reference doc — future call. Python's 16h skip window lives in that same future epic.
4. **`GOOGLE_API_KEY` consistency with existing stack** — GravityClaw already used this env var name for Gemini; no conflict.

## Cost

- OpenAI embeddings: 2 × ~15 tokens each ≈ 30 tokens × $0.02 / 1M = **~$0.000001**
- Gemini calls: 0 (key not set, fallback path used)
- Supabase Edge Function invocations: 2 × 2 items + internal SQL
- **Total: effectively $0.** Well under the $5 budget.

## What's next

Top unblocked `⚪` epics from the backlog:

- **W2.4** — MCP tool `capture` exposed to Claude chat. Small, useful for Cordis (capture + signals are the two one-shot write surfaces).
- **W2.5** — File upload path via Storage.
- **W4.1** — Lev agent scaffolding.
- **Optional follow-up to this run:** ship an `ops/scripts/ingest-signals.ts` companion to feed the Edge Function from local yt-dlp + feedparser, closing the automation loop.

Proceeding to nothing automatic — this is the end of the autonomous run. Return summary goes back to Edmund.
