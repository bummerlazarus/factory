# YouTube Ingest Edge Function

Chunks, embeds, and stores YouTube video transcripts into the knowledge graph.

## Design

**Two-phase model**: Caller provides transcript text (fetched locally via `yt-dlp` or similar). The Edge Function handles chunking, embedding, and upserting to `memory` + `agent_youtube_videos` tables.

### Why two-phase?
- **yt-dlp is a binary subprocess** — can't run inside Deno Edge Functions
- **Clean separation**: transcript fetching lives outside; Edge Functions handle unique business logic (chunk + embed + store)
- **Flexibility**: easy to add alternative transcript sources (paid APIs, Firecrawl, etc.) later without changing the Edge Function

## API Contract

### Request

```
POST /functions/v1/youtube-ingest
Header: x-capture-secret: <CAPTURE_SECRET>
Content-Type: application/json
```

```json
{
  "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "video_id": "dQw4w9WgXcQ",
  "title": "Video Title (optional)",
  "channel_name": "Channel Name (optional)",
  "transcript": "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHello world...",
  "transcript_format": "vtt",
  "tags": ["owned", "priority"],
  "force": false
}
```

**Field reference:**
- `video_url` or `video_id` (required): YouTube URL or video ID
- `title`, `channel_name` (optional): If not provided, fetched via YouTube Data API (if `YOUTUBE_API_KEY` set)
- `transcript` (required): Transcript text in VTT or plain format
- `transcript_format` (optional): `"vtt"` for WebVTT (with timestamps), `"plain"` for text. Defaults to `"plain"`
- `tags` (optional): Array of strings for metadata
- `force` (optional): If `true`, re-ingest and replace old chunks. Defaults to `false`

### Response

**Success (200)**:
```json
{
  "video_id": "dQw4w9WgXcQ",
  "title": "Video Title",
  "channel_name": "Channel Name",
  "is_owned": false,
  "chunks_written": 12,
  "memory_ids": ["uuid1", "uuid2", ...],
  "table_upserted": true,
  "warnings": []
}
```

**Already ingested (200)**:
```json
{
  "video_id": "dQw4w9WgXcQ",
  "skipped": true,
  "reason": "already_ingested",
  "message": "Call again with { force: true } to re-ingest."
}
```

**Errors (4xx)**:
```json
{
  "error": "Error message"
}
```

### Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success or idempotent skip |
| 400 | Missing required fields (transcript, video_url/video_id) |
| 401 | Missing/invalid `x-capture-secret` header |
| 405 | Non-POST method |
| 500 | Server error (missing Supabase config) |

## Warnings

| Warning | Meaning |
|---------|---------|
| `youtube_api_key_not_set` | `YOUTUBE_API_KEY` not set; title/channel/metadata fetched manually or not available |
| `youtube_metadata_fetch_failed` | YouTube API call failed; proceeding with manual title/channel if provided |
| `memory_skipped_no_openai` | `OPENAI_API_KEY` not set; chunk stored in memory table but **not embedded** |
| `memory_insert_failed` | Embedding succeeded but memory insert failed (rare) |
| `memory_partial_failure` | One or more chunks failed to embed/insert; partial results returned |
| `table_upsert_failed` | Video record failed to upsert to `agent_youtube_videos`; memory may have been written |

## Secrets

### Required
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (for table writes)
- `CAPTURE_SECRET` — Auth token for `x-capture-secret` header

### Optional
- `OPENAI_API_KEY` — For embedding chunks. If missing, chunks are stored unembedded (warning logged)
- `YOUTUBE_API_KEY` — For fetching video metadata (title, channel, description). If missing, manual title/channel required in request
- `YOUTUBE_CHANNEL_ID` — Used to detect owned videos (`is_owned: true` when `snippet.channelId` matches)

## Chunking Strategy

- **Target**: 300 words per chunk
- **Overlap**: 50 words (for semantic context)
- **Stride**: 250 words (300 - 50)
- **Metadata**: Each chunk stores `start_time`, `end_time` (from VTT), `chunk_index`, and `total_chunks`

## Database Impact

### `public.memory` table
One row per chunk:
```sql
SELECT content, namespace, source, source_id, embedding, metadata 
FROM memory 
WHERE source = 'youtube' AND metadata->>'video_id' = 'dQw4w9WgXcQ'
```

Metadata shape:
```json
{
  "source": "youtube",
  "video_id": "dQw4w9WgXcQ",
  "title": "Video Title",
  "channel_name": "Channel Name",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "timestamp_url": null,
  "start_time": "00:00:05.000",
  "end_time": "00:00:15.000",
  "chunk_index": 0,
  "total_chunks": 12,
  "is_owned": false,
  "tags": ["owned"]
}
```

### `public.agent_youtube_videos` table
One row per video (upserted on `video_id`):
```sql
SELECT video_id, title, channel_name, description, transcript, is_owned, published_at 
FROM agent_youtube_videos 
WHERE video_id = 'dQw4w9WgXcQ'
```

## Examples

### Curl: Minimal ingest (plain text)
```bash
curl -X POST https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/youtube-ingest \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "video_id": "dQw4w9WgXcQ",
    "title": "My Video",
    "channel_name": "My Channel",
    "transcript": "Hello world. This is a test transcript."
  }'
```

### Curl: With VTT timestamps
```bash
curl -X POST https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/youtube-ingest \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "video_id": "dQw4w9WgXcQ",
    "transcript": "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHello world\n\n00:00:05.000 --> 00:00:10.000\nThis is a test",
    "transcript_format": "vtt",
    "tags": ["owned", "priority"]
  }'
```

### Deno: With yt-dlp companion script
See `ops/scripts/ingest-youtube.ts` for the two-phase workflow: fetch transcript locally, then POST here.

### Force re-ingest
```bash
curl -X POST https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/youtube-ingest \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "video_id": "dQw4w9WgXcQ",
    "transcript": "Updated transcript...",
    "force": true
  }'
```

## Idempotency

- By default, posting the same `video_id` twice returns `{ skipped: true }` (no work done)
- Use `force: true` to replace existing chunks
- On force re-ingest, old chunks are deleted before new ones are inserted

## Acceptance Criteria (W4.4)

- [x] Fresh ingest returns `chunks_written > 0` and `table_upserted: true`
- [x] Memory rows match count: `SELECT count(*) WHERE source='youtube' AND video_id='...'` = `chunks_written`
- [x] Video record created in `agent_youtube_videos`
- [x] Re-POST same body → `skipped: true` without `force: true`
- [x] Missing `OPENAI_API_KEY` → warning but structural upsert succeeds
