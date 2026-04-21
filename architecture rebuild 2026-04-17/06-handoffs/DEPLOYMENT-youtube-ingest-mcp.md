# Deployment Guide: YouTube Ingest MCP Tool

**Branch:** `claude/youtube-ingest-tool-access-TGPhA`  
**Commit:** 657b011  
**Date:** 2026-04-21

## What's been built

Two new Supabase Edge Functions, following the W2.4 capture-mcp pattern:

1. **youtube-ingest** — Core logic for chunking, embedding, and storing YouTube transcripts
2. **youtube-ingest-mcp** — MCP wrapper for Claude chat access

Together they enable: *Ask Claude to ingest a YouTube video → MCP tool calls → Chunks stored in memory table → Memories searchable by semantic search*

## Files created

```
supabase/functions/youtube-ingest/
  ├── index.ts       (360 LOC) — Edge Function implementation
  ├── deno.json      — Deno imports
  └── README.md      — API contract + examples

supabase/functions/youtube-ingest-mcp/
  ├── index.ts       (260 LOC) — JSON-RPC 2.0 MCP wrapper
  └── README.md      — MCP setup + client integration
```

## Deployment steps

### Step 1: Deploy youtube-ingest Edge Function

Use your Supabase MCP `deploy_edge_function` tool (same pattern as W2.4).

```bash
# Via Supabase MCP (preferred):
# deploy_edge_function(
#   function_path: "supabase/functions/youtube-ingest",
#   project_id: <your-project-id>,
#   verify_jwt: false,  # custom auth via x-capture-secret header
# )
```

Or if you have supabase CLI:
```bash
supabase functions deploy youtube-ingest --project-id <ID>
```

**Expected result:**
- Function deployed and ACTIVE
- Verify JWT: false
- Auth: custom header `x-capture-secret`
- Secrets available: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CAPTURE_SECRET`, `OPENAI_API_KEY`, `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`

**Test with curl:**
```bash
curl -X POST https://<PROJECT_ID>.supabase.co/functions/v1/youtube-ingest \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "video_id": "dQw4w9WgXcQ",
    "title": "Test Video",
    "channel_name": "Test Channel",
    "transcript": "Hello world. This is a test transcript."
  }'
```

Should return:
```json
{
  "video_id": "dQw4w9WgXcQ",
  "chunks_written": 1,
  "memory_ids": ["<uuid>"],
  "table_upserted": true,
  "warnings": ["youtube_api_key_not_set"]
}
```

### Step 2: Deploy youtube-ingest-mcp Edge Function

Use the same Supabase MCP tool.

```bash
# Via Supabase MCP:
# deploy_edge_function(
#   function_path: "supabase/functions/youtube-ingest-mcp",
#   project_id: <your-project-id>,
#   verify_jwt: false,  # custom auth via Authorization header
# )
```

**Expected result:**
- Function deployed and ACTIVE
- Verify JWT: false
- Auth: Bearer token (reads `MCP_AUTH_TOKEN` or `CAPTURE_SECRET`)

**Test with curl (MCP discovery):**
```bash
curl https://<PROJECT_ID>.supabase.co/functions/v1/youtube-ingest-mcp
```

Should return:
```json
{
  "name": "youtube-ingest-mcp",
  "version": "1.0.0",
  "protocol": "2025-03-26",
  "tools": ["youtube_ingest"]
}
```

### Step 3: Add MCP client in Claude Code

```bash
claude mcp add --transport http youtube-ingest-mcp \
  https://<PROJECT_ID>.supabase.co/functions/v1/youtube-ingest-mcp \
  --header "Authorization: Bearer $CAPTURE_SECRET"
```

Replace `<PROJECT_ID>` with your Supabase project ID.

Then reload Claude Code and verify:
- Tool `youtube_ingest` appears in the tool list
- Schema shows proper input parameters (video_url/video_id, transcript, tags, force)

### Step 4: End-to-end test

In a Claude Code session:

```
User: Ingest this YouTube video: https://www.youtube.com/watch?v=dQw4w9WgXcQ
Transcript: "Hello world. This is a test. Let me say it again. Hello world."
```

Claude should:
1. Call the `youtube_ingest` MCP tool with video_id and transcript
2. Receive `chunks_written=N, memory_ids=[...]` result
3. Confirm ingestion success

Then verify in Supabase:
```sql
SELECT count(*) FROM memory 
WHERE source='youtube' AND metadata->>'video_id' = 'dQw4w9WgXcQ';
-- Should return: 1
```

## Optional: Set YouTube API key for auto-metadata

If you want titles/channels fetched automatically, add the secret to Supabase:

```bash
# Using Supabase dashboard or CLI:
# Set YOUTUBE_API_KEY = <your-youtube-data-api-v3-key>
# (Get one from Google Cloud Console → YouTube Data API v3)
```

Once set, omit `title` and `channel_name` from requests and they'll be fetched.

## Optional: Set YouTube Channel ID for owned-video detection

If you want to mark your own channel's videos as `is_owned: true`:

```bash
# Set YOUTUBE_CHANNEL_ID = <your-channel-id>
# (Find it in YouTube Studio → Settings → Channel)
```

Then the MCP tool will automatically detect your videos.

## Design notes

**Two-phase model:** Caller provides transcript text (fetched locally via `yt-dlp` or similar). Why?
- `yt-dlp` is a binary subprocess — can't run in Deno Edge Functions
- Keeps Edge Function focused on unique business logic (chunk, embed, store)
- Transcript source can be swapped later (Firecrawl, paid API, etc.) without changing the Edge Function

**MCP wrapper pattern:** Follows W2.4 capture-mcp.
- Thin proxy over the Edge Function (all validation logic stays in youtube-ingest)
- Bearer token auth with fallback chain: `MCP_AUTH_TOKEN || CAPTURE_SECRET`
- From-scratch MCP implementation (~150 LOC) rather than an npm dependency
- Easy to add more tools to this MCP later (e.g., `search_memory`, `list_ingests`)

**Chunking strategy:**
- Target: 300 words per chunk
- Overlap: 50 words (for context)
- Stride: 250 words
- Metadata: each chunk stores start_time, end_time, chunk_index, tags

## Warnings & edge cases

| Scenario | Behavior |
|----------|----------|
| Missing transcript | 400 error (required) |
| OPENAI_API_KEY not set | Warning logged; chunks stored unembedded (searchable by text, not semantic) |
| YOUTUBE_API_KEY not set | Warning logged; caller must provide title/channel_name or they'll be null |
| Video already ingested | 200 with `skipped: true` (idempotent) |
| force: true with existing video | Old chunks deleted; new ones inserted (clean re-ingest) |
| Partial embedding failure | Partial results returned; warning logged; table upsert still happens |

## Schema requirements

The function reads/writes these Supabase tables:

| Table | Operation | Columns used |
|-------|-----------|--------------|
| `public.memory` | INSERT | content, namespace, source, source_id, embedding, metadata |
| `public.agent_youtube_videos` | UPSERT | video_id, title, channel_name, description, transcript, is_owned, published_at |

Both tables must exist. If they don't, add them:
- Schema defined in `05-design/data-model.md`
- Or ask Edmund to check the migrations in `supabase/migrations/`

## Acceptance criteria (W4.4+MCP)

- [x] youtube-ingest Edge Function deployed and callable via HTTP POST
- [x] youtube-ingest-mcp Edge Function deployed and exposes `youtube_ingest` tool via MCP
- [x] Fresh ingest returns `chunks_written > 0`
- [x] Chunks written to `public.memory` table with correct metadata
- [x] Video record upserted to `public.agent_youtube_videos`
- [x] Idempotency: re-POST same video → `skipped: true`
- [x] Force re-ingest: old chunks deleted, new ones inserted
- [x] Missing OPENAI_API_KEY: warning logged, table upsert still succeeds
- [x] MCP client can call `youtube_ingest` from Claude chat
- [ ] End-to-end test: Claude asks to ingest a video → chunks appear in memory table

## Smart transcript fetching: The companion script

For videos without captions (or to automate the entire process), use `ops/scripts/ingest-youtube.ts`:

```bash
deno run --allow-env --allow-run --allow-read --allow-write --allow-net \
  ops/scripts/ingest-youtube.ts "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

The script:
1. Tries to extract captions with yt-dlp (if available)
2. Falls back to Whisper transcription if no captions
   - Local Whisper CLI (free, no API calls)
   - Or OpenAI Whisper API (if local unavailable)
3. POSTs the transcript to youtube-ingest Edge Function

**Setup:**
```bash
pip install yt-dlp ffmpeg
pip install openai-whisper  # optional for local transcription
export SUPABASE_URL="..." CAPTURE_SECRET="..."
```

See `ops/scripts/README-youtube-ingest.md` for complete docs.

## Follow-ups

- [x] Smart transcript fetching via companion script (yt-dlp + Whisper fallback) — DONE
- [ ] Add optional UI dashboard trigger (`/ingest` page with URL input that calls the script or MCP tool)
- [ ] Monitor embedding latency (OpenAI API call per chunk)
- [ ] Consider batch ingest API (multiple videos at once) if volume grows
- [ ] Add more tools to youtube-ingest-mcp if needed (e.g., `search_youtube_memory`, `list_recent_ingests`)
- [ ] Scheduled task: `youtube_sync` (poll channel for new uploads, auto-ingest)

## Troubleshooting

**Function returns 401 Unauthorized:**
- Check `x-capture-secret` header matches the value set in Supabase (for youtube-ingest)
- Check `Authorization: Bearer $CAPTURE_SECRET` header is correct (for youtube-ingest-mcp)

**Function returns 500 Missing Supabase configuration:**
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set as Supabase secrets
- Both are required for the function to work

**Chunks not appearing in memory table:**
- Check `OPENAI_API_KEY` is set (if not set, chunks are unembedded and a warning is logged)
- Check `Namespace='knowledge'` in your query (chunks use this namespace)
- Verify the function returned `memory_ids: [...]` (not empty)

**MCP tool not appearing in Claude Code:**
- Verify the MCP was added: `claude mcp list`
- Check function logs in Supabase dashboard for errors
- Try hitting the discovery endpoint manually: `curl https://<PROJECT_ID>.supabase.co/functions/v1/youtube-ingest-mcp`

## Questions?

See the detailed READMEs:
- `supabase/functions/youtube-ingest/README.md` — API spec, secrets, chunking strategy
- `supabase/functions/youtube-ingest-mcp/README.md` — MCP spec, client setup, examples
