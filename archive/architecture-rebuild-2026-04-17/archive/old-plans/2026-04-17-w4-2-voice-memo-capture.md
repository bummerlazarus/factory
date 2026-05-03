# W4.2 — Voice memo capture path for `capture()`

**Date:** 2026-04-17
**Epic:** W4.2 — extend `capture()` Edge Function with a voice-memo pipeline (audio upload → Whisper → text-capture downstream).
**Status:** 🟢 DONE. Shipped v17. See run log at [../../06-handoffs/autonomous-runs/2026-04-17-w4-2-voice-memo-capture.md](../../06-handoffs/autonomous-runs/2026-04-17-w4-2-voice-memo-capture.md).

## Decision: one-phase, base64 in JSON

Two shipping options existed:

| Option | How it works | Why not |
|---|---|---|
| **One-phase** (chosen) | Caller POSTs `{ kind:"voice", content:"<base64 audio>", audio_mime }`. Edge Function decodes, uploads to Storage, calls Whisper, writes work_log + memory in one round-trip. | — |
| Two-phase | Caller asks for a signed Storage upload URL, PUTs bytes there, then POSTs `{ storage_path }`. Avoids base64 overhead + Edge body-size limits. Better for >25 MB audio. | Whisper's own cap is 25 MB; bigger audio needs chunking we don't want to solve yet. Single POST = simpler caller DX for Lev, Shortcuts, dashboard. |

Rationale:
- Whisper's hard limit is 25 MB. Any one-phase caller hitting it already has to chunk upstream.
- Edge Functions accept 100 MB bodies; base64'd 25 MB = ~33 MB, well inside the ceiling.
- Matches the "one POST per capture" pattern that text + URL already establish.
- If we later need >25 MB, we can add a two-phase flavour (`{ storage_path }`) without breaking one-phase callers — the branch on `kind==='voice'` just becomes "if content looks like a path, reuse; else decode".

## Shape

**Request:**
```json
POST /functions/v1/capture
x-capture-secret: <CAPTURE_SECRET>

{
  "source":     "claude_iphone" | "ceo_desk" | "dashboard" | ...,
  "kind":       "voice",
  "content":    "<base64 audio bytes, with or without data: prefix>",
  "audio_mime": "audio/mpeg|audio/m4a|audio/wav|audio/webm|audio/ogg|...",
  "audio_ext":  "mp3|m4a|wav|webm|ogg"  (optional; inferred from mime),
  "language":   "en" | ...              (optional Whisper hint),
  "title":      "...",                  (optional),
  "project":    "factory" | ...,
  "metadata":   { ... }
}
```

**200 OK response** (in addition to the existing fields):
```json
{
  "session_id":   "...",
  "work_log_id":  "...",
  "memory_id":    "...",
  "voice": {
    "storage_path":     "voice-captures/<session_id>/<uuid>.<ext>",
    "audio_bytes":      4544,
    "transcript_len":   2,
    "duration_sec":     1,
    "language_detected":"english"
  }
}
```

**Error surface (voice-specific):**

| Code | Body | Meaning |
|---|---|---|
| 400 | `{"error":"validation","field":"audio_mime"}` | Mime missing or not in the allowed set |
| 400 | `{"error":"validation","field":"content","detail":"invalid base64 audio"}` | base64 decode failed |
| 400 | `{"error":"validation","field":"content","detail":"empty audio"}` | Decoded to 0 bytes |
| 413 | `{"error":"audio_too_large","limit_bytes":26214400,"got_bytes":…}` | Over 25 MB post-decode |
| 422 | `{"error":"empty_transcript","storage_path":"…"}` | Whisper returned zero-length text (silence, music) |
| 500 | `{"error":"server_misconfigured","detail":"OPENAI_API_KEY not set …"}` | Whisper can't be called |
| 500 | `{"error":"storage","detail":"…"}` | Upload to `voice-captures` bucket failed |
| 502 | `{"error":"transcription_failed","detail":"whisper 4xx: …"}` | Whisper itself errored |

## Storage

Bucket `voice-captures`:
- Private (not public).
- 25 MB size limit (matches Whisper).
- Allowed mimetypes: `audio/mpeg, audio/mp3, audio/mp4, audio/wav, audio/x-wav, audio/webm, audio/m4a, audio/x-m4a, audio/ogg`.
- Service-role write (default Storage RLS).
- Object key: `<session_id>/<uuid>.<ext>`. Keyed by session so a retro UI can list all audio for a session without a second index.

Migration: `dashboard/supabase/migrations/20260417040000_voice_captures_bucket.sql`. Idempotent via `on conflict (id) do nothing`.

## Data model touches

No schema changes. Voice captures reuse the existing `sessions`, `work_log`, and `memory` tables:

- `work_log.kind = 'note'`, `work_log.artifacts[0]` = `{ kind:"voice", storage_path, audio_mime, audio_bytes, transcript_len, duration_sec?, language_detected?, transcript_preview }`.
- `memory.namespace = 'knowledge'`, `memory.content` = the transcript text, `memory.metadata` = text-capture metadata + `{ voice:true, storage_path, audio_mime, audio_bytes, duration_sec, language_detected }`.

Downstream search (cascading memory, Lev triage) treats voice captures identically to text captures — no branch needed — because the transcript lives where any text capture's content would.

## Helpers added

- `decodeBase64Audio(raw)` — accepts raw base64 or `data:<mime>;base64,<payload>`; tolerates whitespace; returns `Uint8Array`.
- `uploadAudio(sb, sessionId, bytes, mime, ext)` — puts bytes into `voice-captures/<session_id>/<uuid>.<ext>`. Returns `{ storage_path, bytes }`.
- `transcribeAudio(bytes, mime, ext, apiKey, language?)` — `multipart/form-data` POST to `/v1/audio/transcriptions`, model `whisper-1`, `response_format=verbose_json` for duration + language. Throws on non-2xx.

No refactor of the existing text/url paths. The voice branch plugs in between session handling and URL enrichment; once transcription succeeds, `content` is replaced with the transcript and the handler continues through the shared write path.

## Secrets

All reused — no new ones needed:
- `CAPTURE_SECRET` — unchanged.
- `OPENAI_API_KEY` — now mandatory for `kind=voice` (fails with 500 if unset). Text/URL behaviour unchanged.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — auto.

## Acceptance criteria

1. `POST /capture { kind:"voice", content:<base64 ≤25 MB mp3>, audio_mime:"audio/mpeg" }` returns 200 with `session_id`, `work_log_id`, `memory_id`, and a `voice` envelope carrying `storage_path`, `audio_bytes`, `transcript_len`, and (when Whisper returns them) `duration_sec` + `language_detected`.
2. `work_log.artifacts[0].kind === 'voice'`, `storage_path` matches the returned path.
3. `memory.namespace === 'knowledge'`, `memory.content` = Whisper transcript, `memory.metadata.voice === true`, `memory.metadata.storage_path` matches.
4. The object exists in `storage.objects` under `voice-captures/<session_id>/<uuid>.<ext>` with the right mimetype and size.
5. Existing text + URL captures unchanged. No regression in `KINDS` or shared write path.

All five verified — see run log.

## Budget

$0.006/min of audio @ Whisper. Verification test: 1-second silent MP3 ≈ $0.0001. Total spend well under $0.01.

## Follow-ups (not this epic)

- **Audio playback in dashboard.** The dashboard `/inbox` view can surface `storage_path` and mint a signed URL for playback. Pending dashboard work.
- **Chunking >25 MB.** Add a two-phase variant (`{ storage_path }`) for long recordings, do server-side ffmpeg chunking (Edge Function can't — would need a separate Supabase Edge runner or a queue). Deferred.
- **Language hint on CLI.** Lev / Cordis could pass `"language":"en"` to improve accuracy on terse clips. Optional per call; already wired in.
- **Silent-audio cleanup.** 422 empty-transcript leaves the object in Storage. Add a periodic sweep if this gets noisy.
- **`capture-mcp` exposure.** When we next rev the MCP tool, include `voice` in the schema so Cordis/Lev can call it from Claude chat with an `input_audio` block.
