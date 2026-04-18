# W4.4 — YouTube ingest Edge Function (design decision)

**Date:** 2026-04-17
**Epic:** W4.4 — Port `tools/youtube_ingest.py` from GravityClaw to a Supabase Edge Function
**Status:** ⚪ UNBLOCKED — Edmund picked **option A** (two-phase) 2026-04-17 evening. Executing.

## Why this is blocked

The Python `youtube_ingest.py` shells out to `yt-dlp` for transcript fetching. `yt-dlp` is a binary subprocess — can't run inside a Deno Edge Function. Every other step (metadata, chunk, embed, upsert) ports cleanly. Only the transcript-fetching boundary forks the design.

## The fork

| Option | Transcript source | Runs where | Cost | Reliability | Ship time |
|---|---|---|---|---|---|
| **A. Two-phase (rec)** | Caller provides transcript text (client fetches via `yt-dlp` locally) | Caller (local machine or scheduled task with yt-dlp) → Edge Function chunk/embed | $0 extra | High when used correctly | ~1 hr |
| **B. Paid transcript API** | Supadata / ScrapingDog / Kome over HTTPS | Edge Function end-to-end | $5–20/mo new vendor | High, vendor-managed | ~2 hr (incl. vendor account setup) |
| **C. YouTube timedtext endpoint** | Direct HTTPS GET to `youtube.com/api/timedtext` inside Edge Function | Edge Function end-to-end | $0 | Medium — YouTube breaks this every 6–12 months | ~1.5 hr |
| **D. Firecrawl scrape** | Firecrawl `/v1/scrape` with JS rendering, grab transcript panel | Edge Function end-to-end | Uses existing FIRECRAWL creds | Untested for YouTube; may need JS action | ~2 hr if it works, unknown if not |

## What stays the same across all options

The Edge Function body does:
1. `POST /youtube-ingest { video_url | video_id, transcript?, tags?, force? }`
2. `extractVideoId()` — regex (trivial port)
3. `fetchVideoMetadata(videoId)` — HTTPS GET to YouTube Data API v3 (needs `YOUTUBE_API_KEY` secret). Returns title, channel, description, channelId, publishedAt.
4. `isAlreadyIngested()` — query `memory` for `source='youtube' AND metadata->>'video_id' = $1 LIMIT 1`. If yes and `!force`, 200 with skip reason.
5. Get transcript (per option — see fork).
6. `parseVtt()` + `chunkTranscript()` — direct TS port of Python logic. Target 300 words, 50 overlap, (chunk_text, start_time, end_time, chunk_index).
7. For each chunk: `embed()` via OpenAI (same helper pattern as `capture()`), insert into `public.memory` with `namespace='knowledge'`, metadata = `{ source:'youtube', video_id, title, channel_name, url, timestamp_url, start_time, end_time, chunk_index, is_owned, tags }`.
8. Upsert row into `agent_youtube_videos` (already exists, 362 rows) — `{ video_id, title, channel_name, description, transcript, is_owned, published_at, channel_id }` with `on_conflict=video_id`.
9. Return `{ video_id, chunks_written, memory_ids, table_upserted, warnings: [] }`.

**Dynamic tags (Gemini + Notion)** — punted from v1. We can add it later as a hook; Python ingest defaults to `tags=[]` when `NOTION_TAGS_DATABASE_ID` is missing. V1 accepts `tags` in the POST body and does no auto-generation.

## Recommendation

**Option A — two-phase.** Reasons:

1. **Speed to ship.** Edge Function gets written once, deployed once, and stays stable. All transcript-fetching flakiness lives outside it.
2. **No new vendor.** Additive integrations already in-flight (Firecrawl, OpenAI) are plenty; adding a paid transcript API means another bill, another key, another dashboard.
3. **Matches the rebuild principle.** "Edge Functions for unique business logic." Chunk+embed+store is unique. Transcript fetching is commodity; leave it to yt-dlp in a local Node/Python script (or your iPhone Shortcut later).
4. **Zero blast radius if YouTube changes.** The caller (script) updates yt-dlp; the Edge Function doesn't budge.
5. **Degrades gracefully.** If we later swap to option B/C/D, it's purely additive — accept an optional `fetch_transcript_from: 'api' | 'client'` param. The one-phase ingest callers just stop passing `transcript`.

**Trade-off accepted:** autonomy. Edmund (or a scheduled task) has to trigger transcript fetch somewhere that has `yt-dlp`. For the CEO Desk use case, the Cordis-in-Claude-chat tool chain can handle that — MCP tool in `capture` already writes to work_log; a companion MCP tool can orchestrate: (i) shell out to `yt-dlp` via a local Node process, (ii) POST to `/youtube-ingest` with the transcript. That orchestration is W4.4's **companion script**, not the Edge Function itself.

## Proposed v1 scope (if option A)

**In:**
- `supabase/functions/youtube-ingest/index.ts` — the pure-Deno Edge Function described above
- `supabase/functions/youtube-ingest/README.md` — contract + request/response examples
- `ops/scripts/ingest-youtube.ts` — a local Node/Deno script that takes a URL, shells to `yt-dlp`, parses VTT, POSTs to `/youtube-ingest` with transcript text
- Test: one real ingest against a short video to validate end-to-end chunks→memory→`agent_youtube_videos`

**Out (defer to own epic):**
- Dynamic tags (Gemini + Notion) — W4.4b when it's needed
- Batch ingest UI / dashboard trigger — W5.7-adjacent
- `youtube_sync` polling (check channel for new uploads, auto-ingest) — new epic W4.4c later
- Re-ingest / `forget_video` — W4.4d
- Comments sync (`sync_youtube_comments`) — different epic entirely

## Acceptance criteria

1. `POST /youtube-ingest { video_url: "<known short video>", transcript: "<VTT or plain text>" }` returns 200 with `chunks_written > 0` and `table_upserted: true`.
2. `SELECT count(*) FROM public.memory WHERE metadata->>'source' = 'youtube' AND metadata->>'video_id' = '<id>'` equals `chunks_written`.
3. `SELECT title, transcript, is_owned FROM agent_youtube_videos WHERE video_id = '<id>'` returns the expected row.
4. Re-POST same body → 200 with `skipped: true` (already ingested) unless `force: true`.
5. Missing `OPENAI_API_KEY` → 200 with `warnings: ["memory-skipped-no-openai"]` and `table_upserted: true` (structural upsert still happens — matches the `capture()` precedent).

## What I need from Edmund

One of:
- **"A"** — go with two-phase. I'll ship the Edge Function + companion script.
- **"B"** — pick a paid transcript API (tell me which, or ask me to recommend one; Supadata is the cleanest I've seen).
- **"C"** — timedtext inside the Edge Function. Good-enough for owned channels, flakier for random URLs.
- **"D"** — let me spike Firecrawl for 30 min and see if it can extract a clean transcript from a YouTube URL.

If you say "A" I start executing immediately. Other options may need a small spike first.
