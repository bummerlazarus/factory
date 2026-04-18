# `capture()` — API & Recipes

**Status:** 2026-04-17. Canonical reference for calling the capture pipeline from every entry point.
**Function:** `capture` @ Supabase project `obizmgugsqirmnjpirnh` (current version 18 — W2.5 file uploads. See `/dashboard/supabase/functions/capture/README.md` for the server-side doc).

## The one URL

```
POST https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture
```

Every entry point hits this URL. `verify_jwt: false`; auth is the `x-capture-secret` header (shared secret). One pipeline, three mouths.

## Headers

```
Content-Type: application/json
x-capture-secret: <value of CAPTURE_SECRET in Supabase function secrets>
```

## Body

```json
{
  "source":      "ceo_desk | claude_desktop | claude_iphone | claude_code |
                  claude_cowork | dashboard | edge_function | mcp |
                  scheduled_task | unknown",
  "app":         "ceo-desk" | null,         // free-text project tag for sessions.app
  "session_id":  "<uuid>" | null,           // reuse or null to open a new session
  "kind":        "text" | "url" | "voice" | "file",
  "content":     "<text body | absolute URL | base64 audio | base64 binary | inline text>",
  "project":     "factory | zpm | cordial-catholics | real-true |
                  faith-ai | dc-clients | em-brand" | null,  // goes to work_log.project
  "title":       "<optional>" | null,
  "metadata":    { ... } | null,

  // Voice-only (required when kind === "voice"):
  "audio_mime":  "audio/mpeg | audio/m4a | audio/wav | audio/webm | audio/ogg | ...",
  "audio_ext":   "mp3 | m4a | wav | webm | ogg",  // optional; inferred from mime
  "language":    "en" | ...,                       // optional Whisper hint

  // File-only (required when kind === "file"):
  "mime":        "application/pdf | image/png | image/jpeg | image/webp |
                  text/markdown | text/plain",
  "filename":    "deck.pdf"                        // used for Storage key + artifact metadata
}
```

## Response

**200 OK**
```json
{
  "session_id":       "<uuid>",
  "work_log_id":      "<uuid>",
  "memory_id":        "<uuid>",         // present when OPENAI_API_KEY is set + embedding succeeded
  "memory_warning":   "<string>",        // present when embedding/insert failed (capture still succeeded)
  "enriched": {                          // present only for kind=url
    "final_url":          "…",
    "status_code":        200,
    "content_type":       "…",
    "page_title":         "…",
    "enrichment_source":  "firecrawl" | "bare_fetch",
    "markdown_len":       12345           // 0 on bare_fetch
  },
  "voice": {                              // present only for kind=voice
    "storage_path":       "voice-captures/<session>/<uuid>.<ext>",
    "audio_bytes":        4544,
    "transcript_len":     2,
    "duration_sec":       1,               // from Whisper verbose_json
    "language_detected":  "english"        // from Whisper verbose_json
  },
  "file": {                                // present only for kind=file
    "mime":               "application/pdf",
    "filename":           "deck.pdf",
    "bytes":              122635,          // decoded binary size (or UTF-8 len for inline text)
    "inline":             false,           // true for text/*; false for pdf/image
    "storage_path":       "captures/<session>/<uuid>.<ext>",  // omitted for inline text
    "pages":              5,                // PDFs only — rough /Type /Page count
    "word_count":         120,              // PDFs only — post-extract
    "extract_warning":    "no extractable text (likely image-only PDF)"  // PDFs only, when extract ran dry
  }
}
```

Error codes: 400 validation / 401 unauthorized / 404 session_not_found / 405 method / 413 audio_too_large|file_too_large / 422 empty_transcript / 500 db|server_misconfigured|storage / 502 transcription_failed.

## Where data lands

| Row | Table | Notes |
|---|---|---|
| Session | `public.sessions` | one new row per capture unless `session_id` passed |
| Capture | `public.work_log` | `kind = 'note'` (text/voice/markdown/plain/image) / `'research'` (url, PDF); light artifact; voice records `storage_path`, `audio_mime`, `duration_sec`; file records `mime`, `filename`, `bytes`, `inline`, `storage_path?`, `pages?`, `word_count?` |
| Embedding | `public.memory` | `source='capture'`, `source_id=work_log.id`, namespace `knowledge` (text/voice/file) / `content` (url); Whisper transcript / Firecrawl markdown / inline text / extracted PDF text stored here. Images + image-only PDFs skip the write with a `memory_warning`. |
| Audio | `storage.objects` (bucket `voice-captures`) | one object per voice capture, keyed `<session_id>/<uuid>.<ext>`. Private; 25 MB cap. Created only for `kind=voice` |
| File | `storage.objects` (bucket `captures`) | one object per non-text file capture (PDF / image), keyed `<session_id>/<uuid>.<ext>`. Private; 50 MB cap. Created only for `kind=file` with binary MIME |

`sessions` + `work_log` + `memory` are the system of record. The dashboard subscribes to `work_log` via Realtime for live inbox updates (W2.2).

---

## Entry points & recipes

### 1. Claude chat — via CEO Desk / any Claude project

**MVP**: MCP tool `capture` (W2.4) — pending wire-up. Until then, Claude calls the Edge Function via Bash inside a Claude-Code-enabled session:

```bash
curl -s -X POST "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture" \
  -H "content-type: application/json" \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -d '{
    "source":  "claude_desktop",
    "app":     "ceo-desk",
    "kind":    "text",
    "content": "Idea: <brain-dump here>",
    "project": "factory"
  }'
```

Once W2.4 lands, Cordis (and any Claude agent given the `capture` tool) writes with a single tool call rather than shelling out.

### 2. Dashboard `/inbox` page (W2.2)

The dashboard already calls Supabase with the service role (`lib/supabase.ts`). For captures initiated from the UI:

```ts
// server action — web/app/inbox/actions.ts (pending)
const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/capture`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-capture-secret": process.env.CAPTURE_SECRET!,
  },
  body: JSON.stringify({ source: "dashboard", kind: "text", content }),
});
```

Dashboard subscribes to `work_log` via Supabase Realtime (inserts) so captures from any surface appear live.

### 3. iPhone Shortcut → webhook

See [`iphone-shortcuts-guide.md`](./iphone-shortcuts-guide.md) (W4.3) for the canonical build — three Shortcuts (text / URL / voice), a shared secrets helper, testing matrix, and curl equivalents.

### 4. URL bookmarklet (desktop)

```js
javascript:(async()=>{await fetch("https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture",{method:"POST",headers:{"content-type":"application/json","x-capture-secret":"<PASTE_SECRET>"},body:JSON.stringify({source:"dashboard",kind:"url",content:location.href,title:document.title,project:"factory"})});alert("Captured");})();
```

Drag to bookmarks bar; click from any page to capture. Stash the secret in a password manager, not the bookmarklet itself if you publish this.

### 5. Email forward → webhook (Zapier / Make)

Zapier pattern:
1. **Gmail trigger** — New email matching filter "to: inbox@edmundmitchell.com" (or a +label pattern).
2. **Webhook action** — POST to the capture URL. Body:
   ```json
   {
     "source": "unknown",
     "kind": "text",
     "title": "{{Subject}}",
     "content": "{{Plain text body}}\n\n--\nFrom: {{From}}",
     "project": "factory"
   }
   ```
3. Headers include `x-capture-secret`.

Works with any tool that can POST JSON: Make.com, n8n, IFTTT (limited), SES parse, Mailgun routes, etc.

### 6. Scheduled Claude task → webhook

Claude scheduled tasks run on cadence. Inside a task, call Edge Function with `source: "scheduled_task"`. Pattern:

```bash
SECRET=$(cat ~/.supabase/capture-secret)
curl -s -X POST ".../functions/v1/capture" \
  -H "x-capture-secret: $SECRET" \
  -d '{"source":"scheduled_task","kind":"text","content":"<synthesized content>"}'
```

Typical use: Daily Recap writing a summary to work_log + memory; Librarian proposing observations.

---

## Setting the secrets (one-time)

**In the Supabase dashboard → Project `obizmgugsqirmnjpirnh` → Edge Functions → Secrets:**

| Secret | Required? | Generate with |
|---|---|---|
| `CAPTURE_SECRET` | Required | `openssl rand -hex 32` |
| `OPENAI_API_KEY` | Optional (gates memory embedding) | OpenAI dashboard → project keys |
| `FIRECRAWL_API_KEY` | Optional (gates URL enrichment path A) | Firecrawl dashboard |

Same `CAPTURE_SECRET` used by every caller. Rotate when leaked (update every entry point simultaneously — mostly just the dashboard env + any Shortcut / bookmarklet).

**Status (2026-04-17):**
- `CAPTURE_SECRET` — verified set (function returns 401 on bad-secret, not 500 misconfigured)
- `OPENAI_API_KEY` — unknown (not queryable via MCP). Captures will return `memory_warning` until set.
- `FIRECRAWL_API_KEY` — unknown. Captures will use bare-fetch until set.

## Rate limiting (TODO)

None today. The function is protected only by the shared secret. If the secret leaks or you start opening the URL to public consumers (web form, third parties), add a Cloudflare / Vercel edge rate-limit layer in front, or a per-secret-rotating scheme on the function.

## Idempotency

`memory` uses `source='capture' + source_id=work_log.id` with a partial unique index. Same `work_log.id` upserts no-op (shouldn't happen in practice — each call inserts a new work_log row).

Different requests with identical content still create separate rows. To dedupe exact replays, add a `metadata.content_hash` and a partial unique index keyed on `(source, content_hash)`.

## Errors to notice

| Symptom | Likely cause |
|---|---|
| HTTP 500 `server_misconfigured` | `CAPTURE_SECRET` (or SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) missing in function secrets |
| HTTP 401 `unauthorized` | Missing / bad `x-capture-secret` header |
| HTTP 200 with `memory_warning: "OPENAI_API_KEY not set..."` | OPENAI_API_KEY not in function secrets — memory embedding skipped |
| HTTP 200 with `enriched.enrichment_source: "bare_fetch"` on a URL | FIRECRAWL_API_KEY not set **or** Firecrawl errored — fallback ran |
| HTTP 400 `validation` + `field` | Check the field; see server README |
