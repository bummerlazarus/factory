# iPhone Shortcuts — `capture()` recipes

**Status:** v1 2026-04-17 (W4.3). Canonical guide for building the three capture Shortcuts on iOS. Extends and supersedes the thumbnail recipe in [`capture-api.md`](./capture-api.md). Edmund builds these once in the Shortcuts.app; after install they run from Home Screen, Share Sheet, Action Button, or the Lock Screen widget.

> Three Shortcuts, one endpoint. Every one of them POSTs JSON to the single `capture()` URL with the shared-secret header — no OAuth, no callbacks, no magic. If a Shortcut stops working, you debug it with the same `curl` snippet at the bottom of this doc.

---

## 1. Overview

| Shortcut | Kind | Trigger | What it sends |
|---|---|---|---|
| **Quick note** | `text` | Home Screen tap / Action Button / widget | Dictated or typed note → `content` |
| **Save URL** | `url` | Share Sheet from Safari, Mail, any app | URL → `content`, optional title |
| **Dictate to Cordis** | `voice` | Home Screen tap / Action Button | Recorded audio → base64 → `content` (requires W4.2 deployed) |

All three land in `public.work_log` and `public.memory` (when `OPENAI_API_KEY` is set) and appear live in the dashboard `/inbox` via Realtime.

---

## 2. Prerequisites

- **iOS 17+** (iOS 18+ recommended for Action Button + interactive widget improvements). The `Encode` action with Base-64 option ships on iOS 17+.
- The capture endpoint URL: `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture`
- The `CAPTURE_SECRET` value from Supabase → Project → Edge Functions → Secrets. Treat this like a password — paste it **once** into a secrets Shortcut (Section 6), then reference it from every capture Shortcut. Never embed it literally in the body of a Shortcut you share.
- Shortcuts.app → Settings → **Allow Running Scripts** enabled (default on iOS 17+).
- For Share Sheet Shortcuts: in Shortcut's Details panel, **Show in Share Sheet** → on, and accept type = URLs.

### One-time: create the secrets helper

Rather than pasting `CAPTURE_SECRET` into three separate Shortcuts, create a tiny helper Shortcut that returns it. All three capture Shortcuts call it via **Run Shortcut**.

1. New Shortcut → name it **`Get Capture Secret`**.
2. Add action **Text** → paste the full secret value into the text field.
3. Add action **Stop and Output** → Output: the Text from step 2.
4. In Details: turn **off** "Show in Share Sheet", "Pin to Menu Bar", "Show on Apple Watch". Turn **on** "Use as Quick Action" only if you want it callable; otherwise leave off.
5. Save.

Now every capture Shortcut starts with: **Run Shortcut → `Get Capture Secret`** → assign output to variable `Secret`. You rotate the secret in one place.

### One-time: pick a default project tag

Captures accept `project ∈ {factory, zpm, cordial-catholics, real-true, faith-ai, dc-clients, em-brand}` or `null`. Most quick captures are `factory`. The voice Shortcut below optionally prompts you to choose.

---

## 3. Shortcut 1 — Quick note (`kind: text`)

Name: **Capture Note**. Purpose: open, type or dictate a line, tap Done, done.

### Actions (in order)

1. **Run Shortcut** → Shortcut: `Get Capture Secret`. Show when run: **off**. — output becomes magic variable `Shortcut Result`; rename to **`Secret`**.
2. **Ask for Input**
   - Input Type: **Text**
   - Prompt: `What's on your mind?`
   - Default Answer: *(empty)*
   - Allow Multiple Lines: **on**
   - Output magic variable: rename to **`Note`**.
3. **Dictionary** — build the JSON body as a native dictionary so the HTTP action serializes it cleanly. Add these keys/values:
   - `source` → Text → `claude_iphone`
   - `kind` → Text → `text`
   - `content` → Text → magic variable **`Note`**
   - `project` → Text → `factory`
   - `app` → Text → `ceo-desk`
   - Output magic variable: rename to **`Body`**.
4. **Get Contents of URL**
   - URL: `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture`
   - Method: **POST**
   - Request Body: **JSON**
   - Headers:
     - `Content-Type` → `application/json`
     - `x-capture-secret` → magic variable **`Secret`**
   - JSON: magic variable **`Body`** (set as the root value; iOS will serialize the dictionary)
   - Output magic variable: rename to **`Response`**.
5. **Get Dictionary Value** → Get: **Value for** → Key: `work_log_id` → Dictionary: **`Response`**. Rename output to **`WorkLogId`**.
6. **If** → Input: **`WorkLogId`** → Condition: **has any value**.
   - **Then** branch: **Show Notification** → Title: `Captured`, Body: `work_log: ` + **`WorkLogId`**, Play Sound: off.
   - **Otherwise** branch: **Show Notification** → Title: `Capture failed`, Body: **`Response`** (renders full error JSON).
7. *(Optional)* **Set Clipboard** → **`WorkLogId`** — handy for cross-referencing in the dashboard.

### The JSON body that goes over the wire

```json
{
  "source":  "claude_iphone",
  "kind":    "text",
  "content": "<whatever you typed>",
  "project": "factory",
  "app":     "ceo-desk"
}
```

### Install

- **Details** panel → set icon (pick a color + glyph; I use indigo + 💭), add to Home Screen, enable for Apple Watch if you want.
- **Action Button** mapping (iPhone 15 Pro+): Settings → Action Button → Shortcut → **Capture Note**.
- **Lock Screen / StandBy widget**: Shortcuts widget → pick **Capture Note**.

### Test it

Tap the Shortcut. Type `test note from iphone`. You should see a `Captured` notification within 2–3 seconds and the note should appear in the dashboard `/inbox` in real time.

---

## 4. Shortcut 2 — Save URL (`kind: url`)

Name: **Capture URL**. Purpose: Share Sheet → "Capture URL" from Safari / Mail / any app.

### Shortcut settings (Details panel, top-right "i")

- **Show in Share Sheet**: **on**
- Accepted types: **URLs** only (uncheck everything else — keeps the Shortcut off the menu for text shares, photos, etc.)

### Actions

1. **Receive** (auto-added when Share Sheet is enabled): Shortcut Input type = **URLs**.
2. **Get URLs from Input** — output variable **`SharedURL`**. (If Share Sheet gave multiple URLs, this grabs the first / handles the list.)
3. **Run Shortcut** → `Get Capture Secret` → rename output to **`Secret`**.
4. *(Optional)* **Choose from Menu** → Prompt: `Project?` → Items: `factory`, `zpm`, `cordial-catholics`, `real-true`, `faith-ai`, `dc-clients`, `em-brand`, `none`. Each branch: **Set Variable** `Project` = the chosen text (or `none`). If you skip this action, hardcode `Project` = `factory` with a Set Variable action instead.
5. **If** — Input: **`Project`** → Condition: **is** → Text: `none`
   - **Then**: no action (leave `Project` as `none`; we'll strip it in the body step).
   - **Otherwise**: no-op.
6. **Dictionary** — keys:
   - `source` → Text → `claude_iphone`
   - `kind` → Text → `url`
   - `content` → magic variable **`SharedURL`** (as a URL — iOS auto-serializes to string)
   - `app` → Text → `ceo-desk`
   - If you included the menu: add `project` only when **`Project`** ≠ `none`. Easiest way: build two Dictionary actions inside the If/Otherwise branches above — one with `project`, one without. Assign both outputs to the same variable **`Body`**.
   - Output variable: **`Body`**.
7. **Get Contents of URL**
   - URL: `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture`
   - Method: **POST**
   - Request Body: **JSON** → **`Body`**
   - Headers: `Content-Type: application/json`, `x-capture-secret: <Secret>`
   - Output: **`Response`**
8. **Get Dictionary Value** → Key `enriched` from **`Response`** → variable **`Enriched`**.
9. **Get Dictionary Value** → Key `page_title` from **`Enriched`** → variable **`PageTitle`**.
10. **If** — **`PageTitle`** has any value
    - **Then**: **Show Notification** → Title: `Saved`, Body: **`PageTitle`**.
    - **Otherwise**: **Show Notification** → Title: `Saved`, Body: **`SharedURL`**.

### The JSON body

```json
{
  "source":  "claude_iphone",
  "kind":    "url",
  "content": "https://example.com/article",
  "project": "factory",
  "app":     "ceo-desk"
}
```

### Install

- Details → **Show in Share Sheet: on**, types = URLs only.
- Also add to Home Screen for manually pasting a URL (swap step 1–2 for **Ask for Input** → type: **URL**, prompt `URL to save?`).
- Test by hitting Share in Safari → scroll to the Shortcuts row → tap **Capture URL**. Expected: `Saved` notification with the page title within 3–6s (Firecrawl path) or 1–2s (bare-fetch fallback).

---

## 5. Shortcut 3 — Voice memo (`kind: voice`)

> **Requires W4.2 deployed.** The `capture()` function must accept `kind: voice` with a base64 payload, upload to the `voice-captures` Storage bucket, and transcribe via Whisper. Status: W4.2 is shipping in parallel with this doc. Before building this Shortcut, verify with: `curl -sS -X POST .../capture -H "x-capture-secret: $S" -d '{"source":"claude_iphone","kind":"voice","content":"AAAA","audio_mime":"audio/m4a"}'` — if the response is `400 validation` on `content` (empty audio) or `413 audio_too_large`, voice is live. If it's `400 validation field=kind`, the function hasn't been redeployed yet.
>
> - [ ] W4.2 deployed & voice branch confirmed responsive

Name: **Dictate to Cordis**. Purpose: tap once, speak, stop; the Shortcut uploads the audio and you get the transcript back in the dashboard inbox plus Whisper's transcript as the notification body.

### Actions

1. **Run Shortcut** → `Get Capture Secret` → variable **`Secret`**.
2. *(Optional — title)* **Ask for Input** → Type: **Text** → Prompt: `Title? (optional — leave empty)` → Default Answer: empty → variable **`Title`**.
3. *(Optional — project)* **Choose from Menu** → Prompt: `Project?` → same items as the URL Shortcut → variable **`Project`**.
4. **Record Audio**
   - Start Recording: **On Tap** (shows a record button you tap to stop) — alternatively **Immediately** with an explicit Stop Recording action later if you want a one-shot "speak, auto-stop" flow.
   - Audio Quality: **Normal** (AAC ~64 kbps; 1 minute ≈ ~500 KB; well under the 25 MB Whisper cap).
   - Output variable: **`AudioFile`**. The file is AAC in an MPEG-4 container — iOS reports mime `audio/m4a`.
5. **Encode** (the iOS Shortcuts action is literally titled "Base64 Encode" in iOS 17+)
   - Input: **`AudioFile`**
   - Mode: **Encode** (not Decode)
   - Line Breaks: **None** (important — JSON doesn't care but it keeps the payload compact)
   - Output variable: **`AudioB64`**.
6. **Dictionary** → keys:
   - `source` → Text → `claude_iphone`
   - `kind` → Text → `voice`
   - `content` → magic variable **`AudioB64`**
   - `audio_mime` → Text → `audio/m4a`
   - `audio_ext` → Text → `m4a`
   - `app` → Text → `ceo-desk`
   - Optionally: `title` → **`Title`** (only include the key when Title has a value — same If/Otherwise split as the URL Shortcut), `project` → **`Project`**, `language` → Text → `en` (hints Whisper; omit for auto-detect).
   - Output variable: **`Body`**.
7. **Get Contents of URL**
   - URL: `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture`
   - Method: **POST**
   - Request Body: **JSON** → **`Body`**
   - Headers: `Content-Type: application/json`, `x-capture-secret: <Secret>`
   - Output: **`Response`**
8. **Get Dictionary Value** → Key `work_log_id` from **`Response`** → variable **`WorkLogId`**.
9. **Get Dictionary Value** → Key `voice` → variable **`Voice`**.
10. **Get Dictionary Value** → Key `transcript_len` from **`Voice`** → variable **`TranscriptLen`**.
11. **If** — **`WorkLogId`** has any value
    - **Then**: **Show Notification** → Title: `Transcribed`, Body: `work_log ` + **`WorkLogId`** + ` · ` + **`TranscriptLen`** + ` chars`.
    - **Otherwise**: **Show Notification** → Title: `Voice capture failed`, Body: **`Response`**.

### The JSON body

```json
{
  "source":     "claude_iphone",
  "kind":       "voice",
  "content":    "<base64 of the m4a bytes — possibly long>",
  "audio_mime": "audio/m4a",
  "audio_ext":  "m4a",
  "app":        "ceo-desk",
  "project":    "factory",
  "title":      "walk thoughts",
  "language":   "en"
}
```

Note: the server accepts `data:audio/m4a;base64,<payload>` data-URL form too (handy if a future iOS version starts outputting data-URLs by default), but the plain base64 string is what iOS 17/18 returns from the Encode action today.

### Install

- Details → icon: crimson + 🎙️. Add to Home Screen as **Dictate to Cordis**. Map the Action Button if voice is your primary capture modality.
- On first run, iOS asks for **Microphone** permission for Shortcuts — approve.
- Voice memos that exceed ~24 minutes at Normal quality start pushing the 25 MB cap; for long dictations, record in multiple chunks.

---

## 6. Shared tips

### Secret storage

- Keep `CAPTURE_SECRET` inside the `Get Capture Secret` Shortcut **only**. Do not paste it into each capture Shortcut. Rotating is then a 10-second edit.
- Do NOT iCloud-share this Shortcut with others; Shortcut iCloud sync shares the plaintext body.
- If you ever screenshot a Shortcut for documentation, crop or redact the Text action inside the secrets helper.

### Surfacing errors

Each Shortcut above ends with an `If → Show Notification` that prints the full response body when something went wrong. Common errors and what they mean:

| Notification body contains | Meaning | Fix |
|---|---|---|
| `"error":"unauthorized"` | bad / missing `x-capture-secret` | Re-paste secret into `Get Capture Secret` |
| `"error":"server_misconfigured"` | function missing env var | Check Supabase dashboard → Edge Functions → Secrets |
| `"error":"validation","field":"kind"` | server doesn't know `voice` yet | W4.2 not deployed — use a text Shortcut meanwhile |
| `"error":"audio_too_large"` | >25 MB audio | Record shorter chunks |
| `"error":"transcription_failed"` | Whisper errored | Usually transient; rerun. If persistent, check `OPENAI_API_KEY` |
| `"error":"empty_transcript"` | silent audio | You stopped before talking, or mic was muted |

### Running in the background (widget)

Shortcut widgets run the Shortcut inline when tapped (iOS 17+). For Shortcuts that prompt (Ask for Input, Choose from Menu), the widget kicks you into the full Shortcuts app to answer. If you want a pure-widget one-tap flow, build a second "no-prompt" variant (`Capture Note — fast`) that hardcodes project + skips the prompt; put that on the widget, keep the prompting one on the Action Button.

### Running from the Lock Screen

- Add **Shortcuts** widget to Lock Screen → pick the Shortcut.
- Voice Shortcut won't autoplay mic from a locked device without unlocking first; plan on Face ID → tap → speak.

### Latency budget

- Text: typically 300–800 ms round-trip plus iOS's Ask-for-Input overhead.
- URL with Firecrawl: 3–6 s (Firecrawl + embed). Bare-fetch fallback: <1 s.
- Voice: upload-bound + Whisper. 30 s audio ≈ 3–5 s total. 5 min audio ≈ 15–25 s.

If a capture feels stuck, pull down Notification Center — the Shortcut running indicator in the Dynamic Island confirms it hasn't died.

---

## 7. Testing matrix

Run these three to confirm the pipeline end-to-end.

### Test A — quick note

1. Run **Capture Note**.
2. Type: `W4.3 shortcut smoke test — text`.
3. Expect: `Captured` notification with a `work_log_id`.
4. Open dashboard `/inbox` → new note card appears with a `NEW` badge.

### Test B — URL

1. Open Safari → any article (e.g. `https://www.anthropic.com/news`).
2. Share → **Capture URL**.
3. Expect: `Saved` notification, title = page title.
4. Dashboard `/inbox` shows URL card with enrichment source (`firecrawl` or `bare_fetch`) and markdown size.

### Test C — voice (requires W4.2)

1. Run **Dictate to Cordis**. Record ~10 seconds: "Test voice capture for W4.3 shortcut, checking transcription and inbox arrival."
2. Expect: `Transcribed` notification with `transcript_len` > 60.
3. Dashboard `/inbox` shows voice card with the Whisper transcript and audio metadata.

### curl equivalents (for laptop debugging)

Helpful when a Shortcut fails and you want to isolate "is it iOS or is it the function?". Set `CAPTURE_SECRET` in your shell first.

```bash
# Text
curl -sS -X POST "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture" \
  -H "content-type: application/json" \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -d '{"source":"claude_iphone","kind":"text","content":"curl smoke test","project":"factory"}' | jq
```

```bash
# URL
curl -sS -X POST "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture" \
  -H "content-type: application/json" \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -d '{"source":"claude_iphone","kind":"url","content":"https://www.anthropic.com/news","project":"factory"}' | jq
```

```bash
# Voice — base64 a local .m4a first, then POST. Requires W4.2 deployed.
B64=$(base64 -i /path/to/sample.m4a | tr -d '\n')
curl -sS -X POST "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture" \
  -H "content-type: application/json" \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -d "{\"source\":\"claude_iphone\",\"kind\":\"voice\",\"audio_mime\":\"audio/m4a\",\"audio_ext\":\"m4a\",\"content\":\"$B64\"}" | jq
```

If curl succeeds and the Shortcut fails with the same body, the bug is in the iOS Shortcut (usually: missing header, malformed Dictionary, or the Encode action is in Decode mode). If curl also fails, fix the function first.

---

## 8. Changelog

- **v1 · 2026-04-17 (W4.3)** — Initial draft. Covers text + URL (live today) and voice (gated on W4.2 deployment). Three Shortcuts, one secrets helper, testing matrix with curl equivalents.
