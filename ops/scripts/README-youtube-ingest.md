# ingest-youtube.ts — Smart YouTube Transcript Fetcher

Companion script for the `youtube-ingest` Edge Function. Handles the "hard problem" of getting transcripts:
- ✅ Extracts captions if available (yt-dlp)
- ✅ Falls back to Whisper if no captions (local or API)
- ✅ POSTs transcript to Edge Function for chunking/embedding

## Why this script exists

The Edge Function uses a **two-phase model**: caller provides transcript, Edge Function handles chunking/embedding. This script automates the "caller" part (transcript fetching).

**Workflow:**
```
YouTube video (with or without captions)
    ↓
ingest-youtube.ts (this script)
    ├─ Try: yt-dlp + captions extract
    ├─ Fallback: download audio → Whisper transcription
    └─ POST transcript to youtube-ingest Edge Function
    ↓
chunks + embeddings in memory table
```

## Installation

### Required
```bash
# yt-dlp (caption extraction + audio download)
pip install yt-dlp

# ffmpeg (audio processing)
# macOS:
brew install ffmpeg
# Linux:
sudo apt-get install ffmpeg
# Windows:
choco install ffmpeg
```

### Optional (for local Whisper transcription)
```bash
# Whisper CLI (local transcription, no API calls)
pip install openai-whisper

# If unavailable, falls back to OpenAI API (requires OPENAI_API_KEY)
```

## Setup

### Environment variables
```bash
export SUPABASE_URL="https://your-project.supabase.co"
export CAPTURE_SECRET="your-capture-secret"
export OPENAI_API_KEY="sk-..." # Optional, only needed if using Whisper API
export YOUTUBE_API_KEY="..."   # Optional, for auto-metadata in Edge Function
export YOUTUBE_CHANNEL_ID="..." # Optional, for owned-video detection
```

Or create a `.env` file and source it:
```bash
source .env
deno run --allow-env --allow-run --allow-read --allow-write --allow-net \
  ops/scripts/ingest-youtube.ts <url>
```

## Usage

### Basic: ingest a video
```bash
deno run --allow-env --allow-run --allow-read --allow-write --allow-net \
  ops/scripts/ingest-youtube.ts "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

### Force re-ingest (delete old chunks first)
```bash
deno run --allow-env --allow-run --allow-read --allow-write --allow-net \
  ops/scripts/ingest-youtube.ts "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --force
```

### From a Deno script
```typescript
import { ingestYoutubeVideo } from "./ingest-youtube.ts";

const result = await ingestYoutubeVideo("https://www.youtube.com/watch?v=...", {
  force: false,
  openaiKey: Deno.env.get("OPENAI_API_KEY"),
});

console.log(`Chunks written: ${result.chunks_written}`);
```

## Transcript sources (priority order)

1. **Captions** (yt-dlp) — fastest, free
   - Auto-generated captions (if available)
   - Manual captions (if creator uploaded them)
   - Output: WebVTT format with timestamps
   
2. **Whisper Local** (openai-whisper CLI) — fast, free
   - Requires: `pip install openai-whisper`
   - Downloads video audio, transcribes locally
   - No API calls, all processing on your machine
   - Runtime: ~5-30 min depending on video length and CPU
   - Quality: excellent, supports multiple languages
   
3. **Whisper API** (OpenAI) — slower, costs $$$
   - Fallback if local Whisper unavailable
   - Requires: `OPENAI_API_KEY` env var
   - Cost: $0.30 per minute of audio
   - Quality: excellent, same model as local Whisper
   - Runtime: depends on API queue

## Output

### Success
```
[Start] Ingesting video: dQw4w9WgXcQ
       Title: RickRoll
       Channel: Rick Astley
       Duration: 3.6m

[yt-dlp] Trying to fetch captions for dQw4w9WgXcQ...
[yt-dlp] ✓ Captions fetched (1234 bytes)
[POST] ✓ Ingested (4 chunks, 4 memory rows)

[Success] YouTube ingest complete
  Video ID: dQw4w9WgXcQ
  Chunks written: 4
  Memory rows: 4
```

### With Whisper fallback
```
[yt-dlp] No captions found (will use Whisper fallback)
[Audio] Captions unavailable, using Whisper fallback...
[yt-dlp] ✓ Audio downloaded (3.6s, ~/tmp/yt_audio_dQw4w9WgXcQ.m4a)
[Whisper] Transcribing locally (this may take a while)...
[Whisper] ✓ Transcribed (5678 bytes, local model)
[POST] ✓ Ingested (5 chunks, 5 memory rows)
```

## When to use this script vs MCP tool

| Scenario | Use script | Use MCP |
|----------|-----------|--------|
| You have the transcript already | No | ✅ Direct MCP call from Claude |
| Video has captions | ✅ Automated captions | Manual copy-paste |
| Video has no captions | ✅ Whisper fallback | Ask Claude to fetch (if Shell tools enabled) |
| Batch ingest 10+ videos | ✅ Loop locally | Script that calls MCP in loop |
| One-off ingest from Claude | No | ✅ MCP tool call |

**In practice:**
- Use **script** for: bulk ingestion, automation, scheduled jobs, when captions aren't available
- Use **MCP tool** for: interactive requests from Claude chat (when you already have the transcript)

## Advanced: custom Whisper model

By default, uses `base` model (74M parameters, ~5 min per hour of audio).

Options:
```bash
# Modify the script to use:
"--model", "tiny",   # fastest (~30s per hour)
"--model", "base",   # default (~5 min per hour)
"--model", "small",  # better (~10 min per hour)
"--model", "medium", # best (~30 min per hour)
```

Edit line in the script:
```typescript
cmd: [
  "whisper",
  audioPath,
  "--model",
  "medium",  // ← change here
  ...
]
```

## Troubleshooting

### yt-dlp not found
```bash
pip install yt-dlp
which yt-dlp  # should print path
```

### ffmpeg not found
```bash
# macOS
brew install ffmpeg

# Linux
sudo apt-get install ffmpeg

# Windows
choco install ffmpeg
```

### Whisper local not found (falls back to API)
```bash
pip install openai-whisper
which whisper  # should print path
```

### Whisper API fails (out of credits)
Set `OPENAI_API_KEY` to a valid key with credits, or use local Whisper instead.

### Permission denied: script not executable
```bash
chmod +x ops/scripts/ingest-youtube.ts
```

### SUPABASE_URL or CAPTURE_SECRET not set
```bash
echo $SUPABASE_URL $CAPTURE_SECRET  # check they exist
# If not, set them in .env or shell
```

### youtube-ingest Edge Function returns 401
Check that `CAPTURE_SECRET` matches the value set in Supabase function secrets.

### Post to Edge Function times out
The Edge Function is fast (<2s). If timeout, check:
- Supabase service is up
- Network connectivity
- OPENAI_API_KEY is valid (if embedding enabled)

## Cost estimate

| Path | Cost |
|------|------|
| Captions (yt-dlp) | $0 |
| Whisper local (CLI) | $0 (CPU time only) |
| Whisper API | $0.30/min of audio |
| OpenAI embeddings | $0.00002 per 1K tokens (~$0.01 per 30-min video) |

## Integration with Claude chat

Future: Claude can call this script if Shell tools are enabled:

```
User: "Ingest https://www.youtube.com/watch?v=dQw4w9WgXcQ"
Claude: "I'll run the ingest script..."
Claude: *executes* ingest-youtube.ts <url>
Claude: "Done! 4 chunks ingested."
```

For now, run manually and provide the result to Claude.

## See also

- `supabase/functions/youtube-ingest/README.md` — Edge Function API
- `supabase/functions/youtube-ingest-mcp/README.md` — MCP wrapper for Claude chat
- `DEPLOYMENT-youtube-ingest-mcp.md` — Complete setup guide
