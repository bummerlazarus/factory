# W4.5 — Signals ingest Edge Function (plan)

**Date:** 2026-04-17
**Epic:** W4.5 — Port `tools/ingest_signals.py` from GravityClaw to a Supabase Edge Function
**Status:** ⚪ → 🔵 EXECUTING. Edmund's autonomous-run charter applies.
**Python source:** `/Users/edmundmitchell/factory/reference/reference-repos/gravityclaw/tools/ingest_signals.py`
**Prior art:** `dashboard/supabase/functions/capture/index.ts` (v7) — the auth / embed / best-effort pattern is copied exactly.

## What the Python ingest does (faithfully)

Read a JSON config (`tools/signal_sources.json`) describing watched sources. For each source:

1. **Incremental skip** — check `signal_source_health` for this `source_name`; skip if `last_checked_at` is less than 16 hours ago (unless `--force`).
2. **Fetch entries.**
   - YouTube URLs → `yt-dlp --playlist-end 2` subprocess → 2 latest videos with title, url, description, upload_date.
   - Everything else → `guess_feed_url()` builds RSS candidates (`/feed/`, `/rss/`, `/feed.xml`, `/rss.xml`, plus the bare URL) and `feedparser.parse()` picks the first one with entries; top-2 items only.
3. **Per-item ingest.**
   - Hash `link` (md5) → `entry_id` (text PK on `signals`).
   - Dedupe: `select id from signals where id = $1`; skip if already present.
   - Call Gemini 2.5 Flash with a curator prompt → `{summary, relevancy_score (1-10), relevancy_reason}`. Score is normalized ×10 to 0-100 scale.
   - `supabase.table("signals").insert({ id, title, url, source_name, category, brand_arm, content_type, priority, summary, relevancy_score, relevancy_reason, published_at })`.
   - **If `score >= 60`:** embed `title + ". " + summary` via Pinecone `upsert_knowledge(chunk_id=f"signal_{entry_id}", ..., namespace="signals")` — non-fatal on failure.
4. **Upsert source health** — recompute `signals_count` + `avg_relevancy` for this `source_name`, write `last_checked_at`, `last_error`.

## The "missing namespace" bug

Two distinct issues collapse into the same symptom (signals are un-findable by semantic search):

1. **Wrong namespace.** The Python writes embeddings to Pinecone `namespace="signals"`, but the factory's pgvector (Supabase `memory` table) only uses three namespaces: `knowledge` (12,787 rows), `content` (208), `conversations` (201). Nothing reads from `"signals"`. The `capture()` convention for text-kind entries is `namespace='knowledge'`; URL-kind is `'content'`.
2. **Low-score signals have zero memory write.** The `score >= 60` gate means ~half the ingested signals never get embedded at all, so `match_memory()` retrieval can never surface them — even if the namespace were right.

**Fix:** Write **every** signal to `public.memory` with `namespace='knowledge'`, `source='signal'`, `source_id=signals.id`. Keep it best-effort (match the capture() precedent): if OPENAI_API_KEY is missing or embed call fails, log, return `memory_warning`, and still upsert the structured row. The score stays in `signals.relevancy_score` and `memory.metadata.relevancy_score` so downstream rankers can threshold.

## Edge Function API

**Endpoint:** `POST /functions/v1/signals-ingest`
**Auth:** header `x-capture-secret: $CAPTURE_SECRET` (same shared secret as capture()). `verify_jwt=false` on deploy.

### Request body

The caller is expected to have already fetched RSS/YouTube entries — **two-phase pattern**, same reasoning as W4.4 (Deno can't shell to `yt-dlp` or `feedparser`; commodity fetching belongs outside the Edge Function).

```jsonc
{
  "source": {
    "name": "Every.to",
    "url": "https://every.to",
    "category": "writing",
    "brand_arm": "em",
    "content_type": "article",
    "priority": "high",
    "watch_for": "AI-native creator workflows"
  },
  "items": [
    {
      "title": "…",
      "link": "https://every.to/…",
      "description": "…",              // optional
      "published_at": "2026-04-17T…Z"    // optional; falls back to now()
    }
  ],
  "force": false                         // optional; if true, re-ingest already-seen links
}
```

### Response

```jsonc
{
  "source_name": "Every.to",
  "processed": 2,
  "inserted": 1,
  "skipped": 1,               // already-ingested (dedup via md5 link hash)
  "results": [
    {
      "id": "<md5(link)>",
      "title": "…",
      "status": "inserted",    // "inserted" | "skipped" | "error"
      "relevancy_score": 80,
      "memory_id": "<uuid>",
      "memory_warning": null,
      "summary_warning": null
    }
  ],
  "source_health": {
    "source_name": "Every.to",
    "signals_count": 47,
    "avg_relevancy": 62.1,
    "last_error": null
  }
}
```

Non-2xx for bad input (missing auth, malformed body, unknown source shape). 200 with per-item `status: "error"` for Gemini / embed / insert failures so a bad item doesn't kill the batch.

### Error / warning map

| Condition | Behavior |
|---|---|
| `CAPTURE_SECRET` secret not set | 500 `server_misconfigured` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` missing | 500 `server_misconfigured` |
| `x-capture-secret` header missing/wrong | 401 `unauthorized` |
| Missing `source.name` / `items` array | 400 `validation` |
| `GOOGLE_API_KEY` missing | item gets `summary_warning: "GOOGLE_API_KEY not set"`, `summary = title`, `relevancy_score = 50`, `relevancy_reason = "Summarization unavailable (no API key)"`. Insert still proceeds. |
| Gemini call throws / returns non-JSON | same as above, reason carries the error string |
| `OPENAI_API_KEY` missing | `memory_warning: "OPENAI_API_KEY not set; skipped memory write"`. `signals` row still inserted. |
| Embed call fails | `memory_warning: <error>`. `signals` row still inserted. |
| `signals` insert fails for one item | per-item `status: "error"`, `error: <pg message>`. Other items continue. |
| All items for source fail | `source_health.last_error` set to aggregated reason; upsert still happens. |

## Schema touched

**Inspected 2026-04-17 via Supabase MCP (`execute_sql`).** No migration needed.

- `public.signals` — PK `id text`, 15 columns. All Python writes fit; `scraped_at` defaults to `now()` so we don't pass it. Matches GravityClaw 1:1.
- `public.signal_source_health` — PK `source_name text`, 6 columns. Upsert target.
- `public.memory` — 8 columns, namespace text, embedding (pgvector USER-DEFINED), `metadata jsonb`. Destination for the best-effort write with `namespace='knowledge'`, `source='signal'`, `source_id=signals.id`.

No columns added, no tables created.

## Implementation plan

**One file:** `dashboard/supabase/functions/signals-ingest/index.ts` (~350 lines).

Helpers copied from capture() pattern verbatim:
- `embed(text, apiKey)` — OpenAI `text-embedding-3-small` @ 1536-dim, 30k-char truncation.
- `json(status, body)` response helper.
- Auth + env guard prelude.

New helpers:
- `md5Hex(s)` — via `crypto.subtle.digest("MD5", …)` (Deno std ships MD5 via `node:crypto` polyfill; we use a tiny inline impl via `Deno.core` or a vetted hex hash — actually we'll use `@std/crypto` MD5 from jsr to match Python's `hashlib.md5`). **Decision:** since we only need a stable 32-char id and Python used MD5, we'll match that with `@std/crypto` `crypto.subtle.digest("MD5", bytes)` which Deno Deploy supports via its WebCrypto. **Update after research:** Deno's WebCrypto doesn't expose MD5. Use JSR `@noble/hashes/md5` (2KB, no deps) — widely used, vetted, and accessible via `npm:` or `jsr:` import. **Final pick:** `import { md5 } from "https://deno.land/std@0.224.0/crypto/unstable_pure.ts"` won't work either. Use `import { crypto as stdCrypto } from "jsr:@std/crypto"` which DOES support MD5 via `stdCrypto.subtle.digest("MD5", bytes)`. This is the canonical Deno path.
- `summarizeWithGemini(item, source)` — POST to `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$KEY` with the Python prompt text verbatim. Parse JSON with the same markdown-fence stripping (`\`\`\`json …\`\`\``). Return `{summary, score, reason, warning?}`.
- `upsertSourceHealth(supabase, sourceName, error?)` — same aggregate-then-upsert pattern as Python.

Main handler:
1. Auth + body validation.
2. For each `item`:
   - Compute `id = md5(link)`.
   - `select id from signals where id = $1` → if found and not `force`, push `status:"skipped"`.
   - Call Gemini; fall back on missing key / error.
   - Insert row into `signals`.
   - Best-effort embed → `memory` insert with `namespace='knowledge'`, `source='signal'`, `source_id=id`, `metadata={source_name, url, category, brand_arm, content_type, priority, relevancy_score, relevancy_reason, published_at, ingested_at}`.
   - Push `status:"inserted"` result.
3. Upsert `signal_source_health` with new count + avg_relevancy.
4. Return results envelope.

### What this port does NOT do (scope bounds)

- **No RSS fetching, no yt-dlp.** Two-phase — caller fetches entries; Edge Function scores+stores. Matches W4.4. A companion script at `ops/scripts/ingest-signals.ts` could be a later epic; not in this run.
- **No 16-hour skip window.** That's a scheduler concern. The caller (cron / scheduled task) decides cadence. Dedup still happens per-item via the md5 check.
- **No `signal_sources.json` config.** The caller passes one `source` per request.
- **No Pinecone.** Embeddings go to Supabase `memory`. This is the whole point of the rebuild.

These bounds shrink the Python source from ~340 LOC to ~350 TS LOC in a single file.

## Acceptance criteria

1. `POST /signals-ingest` with a valid body and 2 items returns 200 with `processed: 2`. `inserted + skipped + errors === processed`.
2. `SELECT * FROM signals WHERE id IN (<md5s>)` returns 2 rows matching the input titles / urls. `relevancy_score` is populated (0-100).
3. `SELECT count(*) FROM memory WHERE source='signal' AND source_id IN (<md5s>) AND namespace='knowledge'` equals `inserted`.
4. `SELECT * FROM signal_source_health WHERE source_name=$1` shows updated `last_checked_at`, `signals_count`, `avg_relevancy`.
5. Re-POST the same body (no `force`) → 200 with `inserted: 0`, `skipped: 2`. No duplicate rows in `signals` or `memory`.

## Decisions made autonomously

1. **Namespace `'knowledge'`** (fixes the bug) — matches capture() text-kind precedent; every signal gets embedded regardless of score; score lives on the row + metadata for downstream filtering.
2. **Two-phase** — Deno can't run `feedparser`/`yt-dlp`. Caller fetches, Edge Function scores+stores. Same shape as W4.4.
3. **Gemini 2.5 Flash direct HTTPS** — no SDK. Matches existing "no new deps" pattern.
4. **MD5 id via `@std/crypto`** — keeps parity with Python's hash so already-ingested signals dedupe correctly if the Python ingest is ever re-run side-by-side.
5. **No migration.** Schema is fine as-is.

## Open questions

None I need to ask Edmund about before executing. Noted for the run log:

- **Companion script for RSS + YouTube fetching** — not in this run. If Edmund wants the full loop automated, we add `ops/scripts/ingest-signals.ts` later. For now the MCP/Cordis agent can POST hand-curated items, or a cron in GravityClaw can be temporarily left in place to feed this function with `items[]` payloads.
- **Where does `signal_sources.json` live now?** Not ported. If needed, it moves to `dashboard/docs/` as a reference doc or becomes a new `signal_sources` table. Flagged for a follow-up.
