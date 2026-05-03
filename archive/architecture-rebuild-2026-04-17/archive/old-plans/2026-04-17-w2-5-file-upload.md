# W2.5 — Generic file upload path for `capture()`

**Date:** 2026-04-17
**Epic:** W2.5 — extend `capture()` Edge Function with a `kind:"file"` branch
covering PDF / image / markdown / plain-text.
**Status:** 🟢 DONE. Shipped v18. See run log at
[../../06-handoffs/autonomous-runs/2026-04-17-w2-5-file-upload.md](../../06-handoffs/autonomous-runs/2026-04-17-w2-5-file-upload.md).

## Decision: one-phase base64, type-dispatched downstream

Mirrors the W4.2 one-phase pattern — caller POSTs everything in a single JSON
body. A separate bucket (`captures`) keeps binary files out of the
`voice-captures` namespace so lifecycle policy, audits, and future per-type
retention can differ.

| MIME class | Storage | Embed | `work_log.kind` |
|---|---|---|---|
| `application/pdf` | `captures` (50 MB cap) | extracted text → `memory` (namespace `knowledge`) | `research` |
| `image/png\|jpeg\|webp` | `captures` | — (defer OCR) | `note` |
| `text/markdown\|plain` | (inline, no Storage) | content → `memory` | `note` |

Rationale:

- **One-phase** matches text/url/voice — keeps caller DX simple. 50 MB binary
  cap is below what would overflow Supabase's edge-body limit; 1 MB inline
  text cap prevents `memory.content` from exploding.
- **PDF routes to `research`** (same as URLs) — you're doing literal research
  when you save a PDF. Markdown/plain/images stay `note`.
- **Images stay dumb in v1.** OCR is a later epic; the artifact + storage
  object + work_log row are enough to surface "I uploaded this" in /inbox.
- **PDF text extraction stays in-Deno** — no new npm dep (per Edmund's
  constraint). Best-effort regex sweep over FlateDecoded streams + `(…) Tj`
  operator extraction. Works on word-processor exports; image-only / CID-font
  PDFs fall through with `memory_warning = "no extractable text…"`. That's
  acceptable v1 behavior — `pdfjs-dist` in Deno has known ESM wrinkles and
  wasn't worth pulling in just to handle the long tail.

## Shape

**Request:**
```json
POST /functions/v1/capture
x-capture-secret: <CAPTURE_SECRET>

{
  "source":   "dashboard | mcp | ...",
  "kind":     "file",
  "mime":     "application/pdf | image/png | image/jpeg | image/webp | text/markdown | text/plain",
  "filename": "deck.pdf",
  "content":  "<base64 for binary; plain text for md/txt>",
  "project":  "factory | ...",
  "title":    "...",
  "metadata": { ... }
}
```

**200 OK response** (in addition to the shared fields):
```json
{
  "session_id":  "...",
  "work_log_id": "...",
  "memory_id":   "...",               // omitted for image / image-only PDF
  "memory_warning": "...",            // present when embedding was skipped or failed
  "file": {
    "mime":            "application/pdf",
    "filename":        "deck.pdf",
    "bytes":           122635,
    "inline":          false,
    "storage_path":    "captures/<session>/<uuid>.pdf",   // omitted for inline md/txt
    "pages":           5,                                   // PDFs only
    "word_count":      120,                                 // PDFs only
    "extract_warning": "no extractable text (likely image-only PDF)"  // PDFs only
  }
}
```

**Error surface (file-specific):**

| Code | Body | Meaning |
|---|---|---|
| 400 | `{"error":"validation","field":"mime"}` | MIME missing or not in the allowlist (e.g. `application/zip`) |
| 400 | `{"error":"validation","field":"filename"}` | Filename missing |
| 400 | `{"error":"validation","field":"content","detail":"invalid base64 file"}` | base64 decode failed (binary branch) |
| 400 | `{"error":"validation","field":"content","detail":"empty file"}` | Decoded to 0 bytes |
| 413 | `{"error":"file_too_large","limit_bytes":52428800,"got_bytes":…}` | Binary file > 50 MB |
| 413 | `{"error":"file_too_large","limit_bytes":1048576,"got_bytes":…}` | Inline text > 1 MB |
| 500 | `{"error":"storage","detail":"…"}` | Upload to `captures` bucket failed |

## Storage

Bucket `captures`:

- Private. 50 MB cap. Allowed mimes: `application/pdf, image/png, image/jpeg,
  image/webp, text/markdown, text/plain`. (Text mimes are on the bucket
  allowlist defensively even though the handler never uploads text.)
- Service-role write only.
- Object key: `<session_id>/<uuid>.<ext>` — same shape as `voice-captures`.

Migration: `dashboard/supabase/migrations/20260417070000_captures_bucket.sql`.
Idempotent via `on conflict (id) do nothing`.

## What changed in the handler

Additive — no text/url/voice branches touched.

- `KINDS` set gets `"file"`.
- New constants: `MAX_FILE_BYTES`, `MAX_INLINE_TEXT_BYTES`, `FILE_MIME_EXT`,
  `ALLOWED_FILE_MIMES`, `BINARY_FILE_MIMES`, `TEXT_FILE_MIMES`.
- Preflight block after the voice preflight: lowercases + validates `mime`,
  trims + sanitizes `filename` (strips path components).
- New helpers: `decodeBase64Binary`, `uploadFile` (hits the `captures`
  bucket), `extractPdfText` (+ `inflateBytes`, `unescapePdfString`).
- Processing block after the voice block: branches by MIME class, writes
  Storage + sets `content` for the shared work_log + memory writers below.
- Work-log artifact + memory metadata gain a file shape; memory is skipped
  with a specific `memory_warning` for images and image-only PDFs.

## Follow-ups

- **OCR** for images + image-only PDFs. Probably a second Edge Function or
  downstream worker; don't bloat capture().
- **Capture MCP wrapper** (`capture-mcp`) doesn't yet expose `file`. Add it
  when we want Claude to save dropped attachments — queue after W2.4b.
- **Dashboard /inbox renderer** for file captures — icon + filename + signed
  URL to Storage + preview for markdown/PDF-extract. Defer.
- **Two-phase uploads** for >50 MB (signed Storage PUT) if that ever matters.
  Today you'd chunk upstream.
