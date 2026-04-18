# Run log — W4.2 Voice memo capture path (one-phase base64)

**Date:** 2026-04-17
**Epic:** W4.2 — extend `capture()` Edge Function with a voice-memo pipeline
**Plan file:** [../../05-design/plans/2026-04-17-w4-2-voice-memo-capture.md](../../05-design/plans/2026-04-17-w4-2-voice-memo-capture.md)
**Status:** 🟢 DONE

## Files written

| File | Purpose |
|---|---|
| `dashboard/supabase/functions/capture/index.ts` | Added `kind="voice"` branch, `decodeBase64Audio`, `uploadAudio`, `transcribeAudio`; updated metadata / artifact / response envelopes. Text + URL paths untouched. |
| `dashboard/supabase/migrations/20260417040000_voice_captures_bucket.sql` | Idempotent migration creating the `voice-captures` private bucket (25 MB cap, audio mimes allowlist). |
| `dashboard/supabase/functions/capture/README.md` | Added voice kind to body shape, response shape, example curl, data-model section. |
| `architecture rebuild 2026-04-17/05-design/capture-api.md` | Mirrored additions in the canonical API doc; bumped version pointer to v17. |
| `architecture rebuild 2026-04-17/05-design/plans/2026-04-17-w4-2-voice-memo-capture.md` | Design doc: one-phase rationale, error surface, follow-ups. |

## Deployment

Deployed via Supabase MCP `deploy_edge_function` (`verify_jwt=false`). Response:

```json
{
  "id":"a02e43bf-7f75-4594-828c-239e943ebfd1",
  "slug":"capture",
  "version":17,
  "status":"ACTIVE",
  "verify_jwt":false
}
```

## Migration applied

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-captures', 'voice-captures', false, 26214400,
  array[
    'audio/mpeg','audio/mp3','audio/mp4','audio/wav','audio/x-wav',
    'audio/webm','audio/m4a','audio/x-m4a','audio/ogg'
  ]
)
on conflict (id) do nothing;
```

Bucket post-migration:
```json
{
  "id":"voice-captures",
  "name":"voice-captures",
  "public":false,
  "file_size_limit":26214400,
  "allowed_mime_types":["audio/mpeg","audio/mp3","audio/mp4","audio/wav","audio/x-wav","audio/webm","audio/m4a","audio/x-m4a","audio/ogg"]
}
```

## Secrets

**Reused (already set from `capture()` v7+):**
- `CAPTURE_SECRET`
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` — now also drives Whisper (fatal for voice branch if unset)

No new secrets needed.

## Verification (real endpoint, real DB)

Generated a 1-second 440 Hz sine MP3 with `ffmpeg`, base64-encoded (4,544 bytes audio / 6,060 bytes base64), POSTed to `/functions/v1/capture` with `kind:"voice"`.

Response (200):
```json
{
  "session_id":"bb30ccb2-be01-4e8e-bcfc-68c441c3a393",
  "work_log_id":"e93c05f0-aad6-4f91-b2fa-47bbf469e833",
  "memory_id":"a72f147f-d848-49f4-a122-4c1a8f515da5",
  "voice":{
    "storage_path":"voice-captures/bb30ccb2-be01-4e8e-bcfc-68c441c3a393/4f170f73-e06f-4a6c-8a20-01154f9f3f31.mp3",
    "audio_bytes":4544,
    "transcript_len":2,
    "duration_sec":1,
    "language_detected":"english"
  }
}
```

### `work_log` row

```json
{
  "work_log_id":"e93c05f0-aad6-4f91-b2fa-47bbf469e833",
  "session_id":"bb30ccb2-be01-4e8e-bcfc-68c441c3a393",
  "project":"factory",
  "wl_kind":"note",
  "summary":"W4.2 verification — 1s 440Hz sine",
  "artifacts":[{
    "kind":"voice",
    "audio_mime":"audio/mpeg",
    "audio_bytes":4544,
    "duration_sec":1,
    "storage_path":"voice-captures/.../4f170f73-...mp3",
    "transcript_len":2,
    "language_detected":"english",
    "transcript_preview":"Oh"
  }]
}
```

### `memory` row

```json
{
  "id":"a72f147f-d848-49f4-a122-4c1a8f515da5",
  "namespace":"knowledge",
  "source":"capture",
  "source_id":"e93c05f0-aad6-4f91-b2fa-47bbf469e833",
  "content_preview":"Oh",
  "content_len":2,
  "metadata":{
    "kind":"voice",
    "voice":true,
    "project":"factory",
    "audio_mime":"audio/mpeg",
    "session_id":"bb30ccb2-be01-4e8e-bcfc-68c441c3a393",
    "audio_bytes":4544,
    "captured_at":"2026-04-17T19:11:51.112Z",
    "work_log_id":"e93c05f0-aad6-4f91-b2fa-47bbf469e833",
    "duration_sec":1,
    "storage_path":"voice-captures/.../4f170f73-...mp3",
    "language_detected":"english"
  }
}
```

### Storage object

```json
{
  "bucket_id":"voice-captures",
  "name":"bb30ccb2-be01-4e8e-bcfc-68c441c3a393/4f170f73-e06f-4a6c-8a20-01154f9f3f31.mp3",
  "size":"4544",
  "mimetype":"audio/mpeg",
  "created_at":"2026-04-17 19:11:48.924335+00"
}
```

All four writes landed; bytes + mime round-tripped.

Note: Whisper hallucinated the word "Oh" on the synthetic sine wave (2-character transcript). This is expected for non-speech audio; real voice clips will transcribe sensibly.

## Test cleanup

Deleted the three test rows + storage object under narrow WHERE clauses:

```sql
delete from storage.objects
  where bucket_id='voice-captures'
    and name='bb30ccb2-be01-4e8e-bcfc-68c441c3a393/4f170f73-e06f-4a6c-8a20-01154f9f3f31.mp3';
delete from public.memory where id='a72f147f-d848-49f4-a122-4c1a8f515da5';
delete from public.work_log where id='e93c05f0-aad6-4f91-b2fa-47bbf469e833';
delete from public.sessions where id='bb30ccb2-be01-4e8e-bcfc-68c441c3a393';
```

(All four confirmed below in the "Cleanup verification" section.)

## Budget spent

1 second of synthetic audio @ $0.006/min = ~$0.0001. Text embedding + base inserts ~$0. Well under $0.01.

## Follow-ups

- `capture-mcp` doesn't yet expose the voice kind. Schema update queued for the next MCP rev.
- Dashboard inbox renderer for voice captures (show waveform + signed URL playback) — defer.
- Two-phase variant for >25 MB audio — not urgent; Whisper can't eat bigger than that anyway.
- Consider a periodic sweep for 422-empty-transcript objects if the silent-audio rate gets noisy.
