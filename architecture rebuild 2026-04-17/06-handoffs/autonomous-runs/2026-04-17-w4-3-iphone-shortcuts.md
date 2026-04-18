# Autonomous run log — W4.3

**Epic:** W4.3 — iPhone Shortcut (doc + template for capture pipeline)
**Plan:** inline (doc-only)
**Status:** 🟢 DONE
**Done:** 2026-04-17

## Summary

Published `05-design/iphone-shortcuts-guide.md` — canonical build guide for three iOS Shortcuts that feed the `capture()` Edge Function: **Capture Note** (text), **Capture URL** (Share Sheet), **Dictate to Cordis** (voice, gated on W4.2). Plus a shared `Get Capture Secret` helper Shortcut so the shared secret lives in exactly one place. Replaced the stub iPhone Shortcut section in `capture-api.md` with a one-line pointer.

No code changes. No `.shortcut` template file (iCloud-signed, not Git-friendly) — text instructions only.

## Files touched

- **NEW** `architecture rebuild 2026-04-17/05-design/iphone-shortcuts-guide.md` — 285 lines. Sections: Overview, Prerequisites + secrets helper, Shortcut 1 text, Shortcut 2 URL, Shortcut 3 voice (checkbox-gated on W4.2), Shared tips, Testing matrix + curl equivalents, Changelog.
- **EDIT** `architecture rebuild 2026-04-17/05-design/capture-api.md` — replaced the iPhone Shortcut subsection (section 3 under "Entry points & recipes") with a single-line pointer to the new guide. No other content changed.
- **EDIT** `architecture rebuild 2026-04-17/06-handoffs/backlog.md` — W4.3 flipped ⚪ → 🟢 with note + link to this run log.

## Verification

Doc-only epic. Accuracy checks against sources of truth:

- **Body shape & field names** verified against `dashboard/supabase/functions/capture/index.ts` @ v7+W4.2-branch:
  - `SOURCES` includes `claude_iphone` ✓
  - `KINDS` = {text, url, voice} ✓
  - Voice fields: `audio_mime`, `audio_ext`, optional `language` ✓ (guide uses `audio/m4a` + `m4a` + optional `en`)
  - `decodeBase64Audio()` accepts both raw base64 and `data:audio/m4a;base64,<payload>` — guide notes both forms accepted, recommends raw
  - Error codes documented in the "Surfacing errors" table mirror server-side returns (`unauthorized`, `server_misconfigured`, `validation`, `audio_too_large` = 413, `transcription_failed` = 502, `empty_transcript` = 422) ✓
- **Endpoint URL** matches `capture-api.md` and server config.
- **iOS action names** — stuck to real Shortcuts actions: "Ask for Input", "Text", "Dictionary", "Get Contents of URL", "Record Audio", "Encode" (Base-64), "Get URLs from Input", "Get Dictionary Value", "If", "Show Notification", "Set Variable", "Choose from Menu", "Run Shortcut", "Set Clipboard", "Stop and Output". No invented actions.

## Decisions made

- **Three separate Shortcuts, not one mega-Shortcut.** Makes each fast from its most natural trigger (Action Button for voice, Share Sheet for URL, Home Screen for text). Users rarely want a branching "what kind?" prompt before capturing.
- **Shared `Get Capture Secret` helper.** Keeps the secret in one Text action instead of three. Rotating = one edit. Called via "Run Shortcut". The guide explicitly warns not to iCloud-share or screenshot it unredacted.
- **Voice section gated with a checkbox + verify-first curl snippet.** Edmund (or sibling W4.2 agent) must confirm `kind:"voice"` doesn't 400-validation before building the voice Shortcut. Safer than assuming.
- **No `.shortcut` binary template.** Those are iCloud-signed blobs, not suitable for Git. Text instructions only — matches the constraint.
- **Included curl equivalents.** Critical for debugging "iOS bug vs function bug" — Edmund can isolate in 5 seconds.
- **`project` default = `factory`.** Matches the existing capture-api.md recipe. Voice + URL Shortcuts include an optional "Choose from Menu" project picker for when it matters.

## Uncertainties / assumed-not-verified

I did **not** build the Shortcut on a real iPhone. Assumptions that should hold but weren't empirically confirmed:

- The **Dictionary** action serializes natively to a JSON object when fed into **Get Contents of URL** with Request Body = JSON. This is documented Apple behavior on iOS 17/18; I haven't watched the wire bytes.
- **Encode** action on iOS 17+ outputs raw base64 (not a data-URL prefix) when input is a binary file from **Record Audio**. Guide notes the server accepts both forms, so either is fine.
- **Record Audio** → output file reports mime `audio/m4a` / AAC in MPEG-4 container. Matches Shortcuts documentation; assumed.
- `Choose from Menu` + conditional Dictionary-build pattern (include `project` key only when chosen ≠ `none`) requires two Dictionary actions in the If/Otherwise branches. This works but is fiddly; Edmund may prefer to just always send `project` with a default.
- iOS 17+ **Encode** action is labeled "Base64 Encode" in some locales and just "Encode" (with Mode toggle) in others. Guide uses "Encode" with explicit Mode=Encode instruction.

## Follow-ups for Edmund

- **You build the Shortcuts.** I can't install them on your iPhone — that's manual. Expected total build time: 20–30 min for all three + the secrets helper.
- **Rotate your CAPTURE_SECRET** before wide use if you ever screenshot the Shortcut to share with Claude or publish. Anything that's been pasted into a Shortcut should be considered "warm."
- **Report back** if any iOS action name in the guide doesn't match what you see in iOS 18+ Shortcuts.app — I can revise. Likely candidate: "Encode" may have been renamed or restructured.
- **Wire the Action Button** to whichever of the three Shortcuts you use most (likely voice or text). iPhone 15 Pro+ only.
- **Consider a "Capture Note — fast"** widget variant (no prompts, hardcoded project) for Lock Screen one-tap capture. Not built here; trivial fork of Shortcut 1.

## Cost

None.

## What's next

- **W4.2 completion** (sibling agent) — once voice branch is live in production, Edmund builds **Dictate to Cordis** and runs Test C from the testing matrix.
- **W2.5 file upload path** or **W5.2 IOC system import** are the next ⚪ items in Wave 2 / Wave 5.
