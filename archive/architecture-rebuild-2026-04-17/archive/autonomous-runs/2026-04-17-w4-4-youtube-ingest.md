# Run log — W4.4 YouTube ingest Edge Function (option A)

**Date:** 2026-04-17 (evening, cont.)
**Epic:** W4.4 — Port `tools/youtube_ingest.py` to Supabase Edge Function, option A (two-phase)
**Plan file:** [2026-04-17-w4-4-youtube-ingest.md](../../05-design/plans/2026-04-17-w4-4-youtube-ingest.md)
**Status:** 🟢 DONE

## Files written

| File | Purpose |
|---|---|
| `dashboard/supabase/functions/youtube-ingest/index.ts` | The Edge Function — metadata + chunking + embedding + dual upsert |
| `dashboard/supabase/functions/youtube-ingest/README.md` | API contract, secrets, warnings map, quick-test example |
| `dashboard/ops/scripts/ingest-youtube.ts` | Deno companion script: `yt-dlp` → VTT → POST |

## Deployment

Deployed via the Supabase MCP (`deploy_edge_function`). The CLI path failed because `SUPABASE_ACCESS_TOKEN` isn't in the shell — the MCP doesn't need it.

Deploy response: `status: ACTIVE`, `verify_jwt: false`, version 1, function id `c1e5471a-12f7-423e-b340-e69ec8a506a8`.

## Secrets

**Reused (already set from `capture()`):**
- `CAPTURE_SECRET`
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

**Not set (warnings fire when absent):**
- `YOUTUBE_API_KEY` — optional, caller supplies title/channel/description when missing
- `YOUTUBE_CHANNEL_ID` — optional, used to set `is_owned=true`

Edmund can set these whenever he wants auto-metadata.

## Verification (real endpoint, real DB)

### 1. Fresh ingest

```
curl -X POST $URL/functions/v1/youtube-ingest \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -d '{
    "video_id": "W44TEST00_1",
    "title": "W4.4 verification test",
    "channel_name": "factory-test",
    "transcript": "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHello world...\n00:00:05.000 --> 00:00:10.000\nWe only expect one chunk here...",
    "transcript_format": "vtt",
    "tags": ["w4-4-test"]
  }'
```

Response:
```json
{
  "video_id": "W44TEST00_1",
  "title": "W4.4 verification test",
  "channel_name": "factory-test",
  "is_owned": false,
  "chunks_written": 1,
  "memory_ids": ["25685a8e-d5a0-4d85-8c9a-c1615894a5b1"],
  "table_upserted": true,
  "warnings": ["youtube_api_key_not_set"]
}
```

DB state:
```sql
SELECT count(*) FROM memory WHERE source='youtube' AND metadata->>'video_id'='W44TEST00_1';
-- → 1 row, chunk_index=0, total_chunks=1, namespace='knowledge'
```

### 2. Idempotency (same body, no force)

Response:
```json
{
  "video_id": "W44TEST00_1",
  "skipped": true,
  "reason": "already_ingested",
  "message": "Call again with { force: true } to re-ingest."
}
```

### 3. Force re-ingest (different transcript)

Response:
```json
{
  "video_id": "W44TEST00_1",
  "title": "W4.4 verification test v2 (forced)",
  "channel_name": null,
  "chunks_written": 1,
  "memory_ids": ["25c71c13-d796-432f-a623-947f858fa125"],
  "table_upserted": true,
  "warnings": ["youtube_api_key_not_set"]
}
```

New memory_id confirms old chunk was wiped and a new one inserted. `agent_youtube_videos` row upserted (title updated via conflict).

### 4. Cleanup

```sql
WITH
  dm AS (DELETE FROM memory WHERE source='youtube' AND metadata->>'video_id'='W44TEST00_1' RETURNING 1),
  dv AS (DELETE FROM agent_youtube_videos WHERE video_id='W44TEST00_1' RETURNING 1)
SELECT (SELECT count(*) FROM dm), (SELECT count(*) FROM dv);
-- → memory_rows_deleted: 1, video_rows_deleted: 1
```

Test data removed — production state back to baseline.

## Key design decisions

1. **Two-phase (option A)** — caller provides transcript. Rationale in [the plan doc](../../05-design/plans/2026-04-17-w4-4-youtube-ingest.md). Approved by Edmund 2026-04-17.
2. **Best-effort embedding per capture() precedent** — if OpenAI fails mid-batch, partial chunks are preserved and `memory_partial_failure` warning fires. The `agent_youtube_videos` row still upserts (the structural record).
3. **Idempotency via `memory.source='youtube' AND metadata->>'video_id'='<id>'`** — no new table, no flags, no migration. `force: true` wipes old chunks before re-ingest for clean counts.
4. **Chunking matches Python** — 300-word target, 50-word overlap, stride 250. Timestamps preserved from VTT, `null` for plain text.
5. **No Notion/Gemini dynamic tags in v1** — punt to W4.4b when needed. Caller supplies `tags` in the body.

## Subagents dispatched

None for W4.4 (executed on main thread). Two concurrent subagents for other epics — see W4.5 and W2.4 run logs.

## Charter compliance

- Worked in main dashboard working dir (not worktree) — same reason as W3.7 (Edmund's uncommitted `capture/` and other work; worktree from HEAD would be missing live state). Diff is purely additive (3 new files in new subdirs).
- Additive Supabase deploy — pre-approved per charter.
- No destructive SQL except intentional test cleanup (narrow `WHERE video_id='W44TEST00_1'`).

## Cost

- OpenAI embedding: 2 calls × ~50 tokens × $0.00002/1k tokens ≈ **$0.000002** (two cents of a cent)
- Supabase function invocations: 3 × ~free
- Deploy: free

Total: essentially zero.

## Follow-ups

- [ ] Edmund: add `YOUTUBE_API_KEY` + `YOUTUBE_CHANNEL_ID` to Supabase function secrets when ready for auto-metadata / owned-channel detection
- [ ] Edmund or a scheduled task: run `ops/scripts/ingest-youtube.ts` against 1 real video to validate the yt-dlp → Edge Function path end-to-end (I didn't test the companion script directly — only the Edge Function receiving a known-good body)
- [ ] W4.4b — dynamic tags (Gemini + Notion) — own epic when content-engine metrics call for it
- [ ] W4.4c — `youtube_sync` polling (auto-detect new uploads, auto-ingest) — new epic
- [ ] W4.4d — `forget_video` — delete chunks + row by video_id — small

## What's next

- W4.5 (signals ingest) — subagent running in background; I'll review + log when it returns
- W2.4 (capture MCP wrapper) — recon complete; plan written; needs Edmund's "same dir vs separate repo" call before exec
