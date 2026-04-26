# Run log — W2.5 Generic file upload capture path (PDF / image / markdown)

**Date:** 2026-04-17
**Epic:** W2.5 — extend `capture()` with a `kind:"file"` branch
**Plan file:** [../../05-design/plans/2026-04-17-w2-5-file-upload.md](../../05-design/plans/2026-04-17-w2-5-file-upload.md)
**Status:** 🟢 DONE

## Files written

| File | Purpose |
|---|---|
| `dashboard/supabase/functions/capture/index.ts` | Added `kind="file"` branch, `decodeBase64Binary`, `uploadFile`, `extractPdfText` + helpers. Text / url / voice paths untouched. |
| `dashboard/supabase/migrations/20260417070000_captures_bucket.sql` | Idempotent migration creating the `captures` private bucket (50 MB cap, pdf/image/text mimes). |
| `dashboard/supabase/functions/capture/README.md` | Added `file` kind to body + response shape, error table, examples, data-model section. |
| `architecture-rebuild-2026-04-17/05-design/capture-api.md` | Mirrored the new kind in the canonical API doc; bumped version pointer to v18. |
| `architecture-rebuild-2026-04-17/05-design/plans/2026-04-17-w2-5-file-upload.md` | Design / rationale doc. |
| `architecture-rebuild-2026-04-17/06-handoffs/backlog.md` | W2.5 flipped to 🟢. |

## Deployment

Deployed via Supabase MCP `deploy_edge_function` (`verify_jwt=false`). Response:

```json
{
  "id":"a02e43bf-7f75-4594-828c-239e943ebfd1",
  "slug":"capture",
  "version":18,
  "status":"ACTIVE",
  "verify_jwt":false
}
```

## Migration applied

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'captures', 'captures', false, 52428800,
  array[
    'application/pdf','image/png','image/jpeg','image/webp',
    'text/markdown','text/plain'
  ]
)
on conflict (id) do nothing;
```

Bucket post-migration:

```json
{
  "id":"captures",
  "name":"captures",
  "public":false,
  "file_size_limit":52428800,
  "allowed_mime_types":["application/pdf","image/png","image/jpeg","image/webp","text/markdown","text/plain"]
}
```

## Secrets

No new secrets required. Re-uses `CAPTURE_SECRET`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` (drives the memory embed on
text / extracted PDF).

## Verification (real endpoint, real DB)

All tests used the live function + project `obizmgugsqirmnjpirnh`. Test data
was deleted after each verify; final row-count check was zero across memory /
work_log / sessions / storage.

### 1) PDF — image-only PDF (`colm2025_conference.pdf`, 123 KB)

Response 200:

```json
{
  "session_id":"aa09fa34-cbe1-4f1e-8f2a-36edb9ecd359",
  "work_log_id":"c6308be9-32ff-4f88-b06d-d582a2ef5b11",
  "memory_warning":"no extractable text (likely image-only PDF)",
  "file":{
    "mime":"application/pdf","filename":"colm2025_conference.pdf",
    "bytes":122635,"inline":false,
    "storage_path":"captures/aa09fa34-.../5934a3ef-...pdf",
    "pages":5,"word_count":0,
    "extract_warning":"no extractable text (likely image-only PDF)"
  }
}
```

Expected: Storage object present, work_log row (`kind=research`), no memory
row. Confirmed via `storage.objects` + `public.work_log` selects.

### 2) PDF — simple text-bearing PDF (594-byte handcrafted "Hello from …")

Response 200:

```json
{
  "session_id":"3c4e6cc8-...",
  "work_log_id":"caf3fc79-...",
  "memory_id":"96da35c7-92ba-4a92-b5d0-5dbdca396989",
  "file":{"mime":"application/pdf","filename":"hello.pdf","bytes":594,
          "inline":false,"storage_path":"captures/.../f3ec25d5-...pdf",
          "pages":1,"word_count":5}
}
```

Text extraction pulled "Hello from the W2.5 verifier." (5 words). Memory row
confirmed with `content_len=29`, namespace `knowledge`, `metadata.file.mime =
"application/pdf"`. Confirms the extractor works on simple text PDFs.

### 3) Markdown — inline

Response 200:

```json
{
  "session_id":"23b761dd-...",
  "work_log_id":"3da8d929-...",
  "memory_id":"88f6a7f7-d69e-4f5c-b977-ee8e5b2c0c8e",
  "file":{"mime":"text/markdown","filename":"note.md","bytes":91,"inline":true}
}
```

Expected: **no** Storage object, memory row present, work_log `kind=note`.
Confirmed — memory row exists with `content_len=91`, no `storage_path`.

### 4) Image — 1×1 PNG (70 bytes decoded)

Response 200:

```json
{
  "session_id":"34b49a70-...",
  "work_log_id":"b49decaa-...",
  "memory_warning":"no text to embed for image/png",
  "file":{"mime":"image/png","filename":"pixel.png","bytes":70,"inline":false,
          "storage_path":"captures/.../298c0322-...png"}
}
```

Expected: Storage object, work_log `kind=note`, **no** memory row. Confirmed.

### 5) MIME rejection — `application/zip`

Response 400: `{"error":"validation","field":"mime"}`. No side effects.

### 6) Size rejection — 51 MB random PDF

Response 413:

```json
{"error":"file_too_large","limit_bytes":52428800,"got_bytes":53477376}
```

Clean structured 413 as specified.

**Note:** A 60 MB payload (83 MB base64) hit Supabase's edge worker compute
ceiling before our own check, returning the runtime's `WORKER_RESOURCE_LIMIT`
(HTTP 546) instead. The handler's own 413 fires for payloads that stay under
the runtime's memory envelope. Documented as an implicit upper bound — real
callers will either base64 under 50 MB (hits our 413) or fail at the edge
(runtime response). Either way, no partial rows are written.

## Test data cleanup

Confirmed zero after cleanup:

```
memory:0  work_log:0  sessions:0  storage:0
```

Storage objects were removed via the Storage REST API (direct SQL delete on
`storage.objects` is blocked by `storage.protect_delete`). DB rows cleaned
via `execute_sql`.

## Budget spent

- 2× text embeddings (markdown 91 chars, hello.pdf 29 chars) @
  $0.02/1M tokens → negligible.
- Storage writes + deletes: ~$0.
- No Whisper / Firecrawl spend.

Well under $0.01 total.

## PDF text extraction — worked / deferred

- **Worked** on the simple 594-byte handcrafted PDF (5 words extracted into
  memory).
- **Deferred gracefully** on `colm2025_conference.pdf` (ICML/COLM template
  with CID-encoded fonts and compressed streams our regex sweep can't
  resolve) — flagged via `memory_warning` + `extract_warning` in the
  envelope; work_log + Storage still written.

This matches the spec: v1 handles simple PDFs, flags the rest, and doesn't
block.

## Follow-ups

- OCR for images + image-only PDFs (separate epic).
- `capture-mcp` doesn't expose `file` yet — out of scope; queue with the next
  MCP rev.
- Dashboard inbox renderer for file captures (icon + signed URL + preview).
- Two-phase signed-upload flow for >50 MB if that ever matters (Edmund's
  own iPhone Shortcuts / webhooks all fit comfortably under 50 MB).
