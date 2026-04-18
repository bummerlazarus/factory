# Run — W4.2 voice memo capture — re-verify (backlog was stale)

**Date:** 2026-04-18
**Status:** 🟢 DONE — not new work. W4.2 was already shipped on 2026-04-17; this run re-verified the live path and corrected the backlog.

## What happened

Edmund asked for Option B (voice memos). Reconnaissance discovered the voice path was already fully implemented in the `capture` Edge Function:

- Git history shows commit `e14b882` (2026-04-17) bundled W4.2 into the initial `capture()` ship: "feat: capture() Edge Function + voice memo support (W2.1/W4.2)".
- `supabase/functions/capture/index.ts` has the full branch: base64 decode → `voice-captures` Storage upload → OpenAI Whisper transcription → transcript-as-text fall-through to the shared work_log + memory write path.
- `supabase/functions/capture/README.md` documents the API contract end-to-end (request shape, response envelope, error codes, example curl).
- Migration `20260417040000_voice_captures_bucket.sql` ships the bucket: private, 25 MB cap, 9 audio MIME types allowed.
- Edge Function `capture` is ACTIVE at version 20 on project `obizmgugsqirmnjpirnh`.

The backlog's W4.2 row was simply stale — marked `⚪ not started` despite the code having shipped a day ago. That got corrected in this run.

## Live re-verification

Generated an 8 KB 0.5s silent WAV (`wave` module, 8kHz mono 16-bit), POSTed to the deployed `capture` endpoint:

```
POST https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture
{
  "source": "edge_function",
  "kind": "voice",
  "content": "<base64-WAV>",
  "audio_mime": "audio/wav",
  "audio_ext": "wav",
  "project": "factory",
  "language": "en"
}

→ 200 OK
{
  "session_id":  "89cd06a1-ac57-454e-9256-99a1f4ce7f46",
  "work_log_id": "3d45f83e-6671-42d1-8285-d4430ca393b2",
  "memory_id":   "47cafbe2-95a6-464c-a039-e4d511f20c47",
  "voice": {
    "storage_path":      "voice-captures/89cd06a1-ac57-454e-9256-99a1f4ce7f46/f5d8c631-4066-4a00-beec-2206ff991ea5.wav",
    "audio_bytes":       8044,
    "transcript_len":    3,
    "duration_sec":      0.5,
    "language_detected": "english"
  }
}
```

Every expected side-effect landed:

- `sessions` row opened.
- `work_log` row inserted (`kind=note`, artifacts payload populated).
- `memory` row inserted — Whisper-transcribed text embedded via `text-embedding-3-small` (1536-dim).
- Storage object uploaded to the private `voice-captures` bucket at the expected key.
- Whisper returned `duration_sec` + `language_detected` (verbose_json working).

## Cleanup

Test rows deleted after verification:

- `memory` row (service-role SQL)
- `work_log` row (service-role SQL)
- `sessions` row (service-role SQL)
- Storage object — deleted via the Supabase Storage REST API (direct SQL delete on `storage.objects` is blocked by a `protect_delete()` trigger). Confirmed 404 after delete.
- Local temp files (`/tmp/voice_smoke.wav`, `/tmp/voice_body.json`).

## Commits

None. This run only touched docs:

- Updated `06-handoffs/backlog.md` W4.2 row to 🟢 DONE with the correction context.
- Added this run log.

## Cost

Supabase: zero migrations.
Anthropic: negligible (one smoke test, some SQL).
OpenAI: one Whisper call on 0.5s of silence + one 1536-dim embedding. ≈ $0.00.

## So — what's actually next?

With W4.2 already done, the genuine remaining work that is **not blocked on an open question or Edmund's content decisions**:

1. **OA.4 — tsconfig cleanup** (XS, ~15 min). Exclude `ops/scripts/` and `supabase/functions/` from the dashboard's tsconfig `include` glob so `npm run build` passes. Parent branch has 57 pre-existing type errors; without this fix Vercel prod deploys stay blocked. Unblocks W9.5.

2. **Route-level `canRunAgent` fix** from the afternoon handoff — actually **already closed** as a side-effect of Option A's wake-queue refactor. `/api/slack/route.ts` no longer calls `canRunAgent(rawMention)` because `enqueueWake` + `drainWakeQueue` handle it.

3. **iPhone Shortcut voice test** — doc W4.3 flagged the voice Shortcut as "gated on W4.2 deploy." W4.2 is deployed. Edmund can now build + test the voice Shortcut in Shortcuts.app. Not autonomous work; flagged for Edmund.

**Blocked on Edmund / decisions:**
- W3.9 prod deploy — needs Q10 resolution.
- W9.2 security hardening — Q10.
- W5.6 Circle metrics — Q12.
- Scope doc enrichment — 5 placeholders per yesterday's handoff.
- W9.3 / W9.4 / W9.5 — destructive, need approval.

## Recommendation to Edmund

Ship **OA.4 tsconfig cleanup** next — it's the only self-contained engineering work that isn't waiting on a decision, and it unblocks the Vercel prod deploy path. Everything else wants your input first.
