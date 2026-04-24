# YouTube Ingest MCP Tool

MCP server exposing the `youtube_ingest` tool to Claude chat. Thin proxy over the `youtube-ingest` Edge Function following the W2.4 `capture-mcp` pattern.

## Architecture

```
Claude Chat (via MCP)
    ↓
youtube-ingest-mcp (this function)
    ↓
youtube-ingest (core Edge Function)
    ↓
Supabase (memory + agent_youtube_videos tables)
```

## API Contract

### Discovery (GET, no auth)

```bash
GET /functions/v1/youtube-ingest-mcp
```

Response:
```json
{
  "name": "youtube-ingest-mcp",
  "version": "1.0.0",
  "protocol": "2025-03-26",
  "transport": "streamable-http",
  "tools": ["youtube_ingest"]
}
```

### MCP JSON-RPC 2.0 (POST)

All POST requests must include:
```
Authorization: Bearer <token>
```

Token = `MCP_AUTH_TOKEN` (if set) or `CAPTURE_SECRET` (default).

#### Initialize
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {}
  }
}
```

#### List Tools
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

Returns single tool: `youtube_ingest` with full `inputSchema`.

#### Call Tool
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "youtube_ingest",
    "arguments": {
      "video_id": "dQw4w9WgXcQ",
      "transcript": "Hello world...",
      "tags": ["owned"]
    }
  }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "isError": false,
    "content": [
      {
        "type": "text",
        "text": "{\"video_id\":\"dQw4w9WgXcQ\",\"chunks_written\":5,...}"
      }
    ]
  }
}
```

## Secrets

### Required
- `SUPABASE_URL` — Supabase project URL (passed to youtube-ingest function)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (passed to youtube-ingest function)
- `CAPTURE_SECRET` — Auth token (used as default for `MCP_AUTH_TOKEN`)

### Optional
- `MCP_AUTH_TOKEN` — Override token for MCP clients. If not set, `CAPTURE_SECRET` is used. Allows rotating MCP tokens independently.

The function also passes through to `youtube-ingest`:
- `OPENAI_API_KEY` — For embedding
- `YOUTUBE_API_KEY` — For metadata fetch
- `YOUTUBE_CHANNEL_ID` — For owned-video detection

## Client Setup

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "youtube-ingest-mcp": {
    "command": "curl",
    "args": [
      "-H",
      "Authorization: Bearer YOUR_CAPTURE_SECRET"
    ]
  }
}
```

Better approach: use `npx @modelcontextprotocol/server-stdio` if you want streaming support.

### Claude Code (Recommended)

```bash
claude mcp add --transport http youtube-ingest-mcp \
  https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/youtube-ingest-mcp \
  --header "Authorization: Bearer $CAPTURE_SECRET"
```

Then verify from a Claude Code session:
- Tool `youtube_ingest` appears in the tool list
- Calling it with a video ID and transcript works end-to-end

### Environment

The `--header` flag in the CLI sets the Bearer token. The function reads `CAPTURE_SECRET` from Supabase env on the server side.

## Examples

### Curl: MCP tools/list
```bash
curl -X POST https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/youtube-ingest-mcp \
  -H "Authorization: Bearer $CAPTURE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

### Curl: Call youtube_ingest
```bash
curl -X POST https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/youtube-ingest-mcp \
  -H "Authorization: Bearer $CAPTURE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "youtube_ingest",
      "arguments": {
        "video_id": "dQw4w9WgXcQ",
        "transcript": "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHello world",
        "transcript_format": "vtt",
        "tags": ["owned"]
      }
    }
  }'
```

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | GET discovery or successful JSON-RPC call |
| 202 | Notifications (per MCP spec) |
| 400 | JSON parse error or malformed JSON-RPC |
| 401 | Missing/invalid Authorization header |
| 405 | Non-GET/POST method |

## Design Decisions

1. **Thin proxy** — All validation and chunking logic stays in `youtube-ingest`. This function only handles MCP protocol and auth.
2. **Bearer token, fallback chain** — `MCP_AUTH_TOKEN || CAPTURE_SECRET`. One secret today; ability to split later.
3. **No streaming** — `youtube_ingest` is fast (<2s worst case), so plain JSON responses suffice. Easy to add SSE support later if needed.
4. **From-scratch implementation** — Direct MCP protocol (~150 LOC) rather than an npm dependency. Deno Edge Functions + imports can surprise; protocol is simple enough to own.

## Follow-ups

- [ ] Test end-to-end from Claude Code: ask Claude to ingest a YouTube video
- [ ] Consider rate limiting (per-token or per-IP) if call volume grows
- [ ] Add optional streaming support (SSE) if long-running pipelines arrive
- [ ] Add more tools to this MCP (e.g., `search_memory`, `list_recent_ingests`) if needed
