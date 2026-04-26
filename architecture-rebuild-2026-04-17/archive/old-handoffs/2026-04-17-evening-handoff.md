# Handoff — evening 2026-04-17

Fresh-session handoff from a long autonomous run. Context window is full in the prior session; this doc captures state so the next session can pick up cleanly.

## What this session accomplished

**Autonomy charter + backlog established.** Edmund delegated priority order and approved continuous run mode with a $10/run cost cap and pre-approved additive Supabase migrations. Three governance docs:
- [autonomy-charter.md](autonomy-charter.md)
- [backlog.md](backlog.md)
- [autonomous-runs/README.md](autonomous-runs/README.md)

**Target-state vision doc** — [finished-state.md](../05-design/finished-state.md) — captures Edmund's expanded vision (Hermes-style self-improving Skills, research-director agents, metrics-wired content engine, expanding team, compounding flywheel).

**Epics closed this session (run logs in `autonomous-runs/`):**

| Epic | Outcome |
|---|---|
| W1.1 🟢 | Pinecone → pgvector migration **complete**. Live counts: knowledge=12,785, content=206, conversations=201 (total 13,192 — matches dry-run exactly). Fixed NUL-byte bug in script. `match_memory()` RPC returns coherent similarity results. |
| W1.2 🟢 | Semantic search convention documented in [supabase/README.md](../../supabase/README.md). Audit confirmed zero live Pinecone callers in factory codebase — historical callers all in the retiring GravityClaw. |
| W2.1a 🟢 | `capture` Edge Function v5 (pre-existing) — text + URL validation, sessions, work_log. |
| W2.1b 🟢 | `capture` **v6** — adds OpenAI embedding write to `memory` table. |
| W2.1c 🟢 | `capture` **v7** — Firecrawl URL enrichment with bare-fetch fallback. |
| W2.2 🟢 | Dashboard `/inbox` page shipped — server-rendered list of captures with text/URL cards, Firecrawl metadata, sidebar nav. |
| W2.2b 🟢 | `/inbox` Realtime subscription — migration 016 adds anon SELECT + realtime publication; `dashboard/lib/supabase-browser.ts` browser client; `dashboard/app/inbox/captures-list.tsx` client component subscribes on mount, prepends new rows with fading "NEW" badge. **Verified working — Edmund confirmed the card appeared live.** |
| W2.3 🟢 | [capture-api.md](../05-design/capture-api.md) — API + recipes for every entry point (Claude chat, dashboard, iPhone Shortcut, URL bookmarklet, email-forward, scheduled tasks), secrets setup, error map. |

**Also:** Edmund set `OPENAI_API_KEY` + `FIRECRAWL_API_KEY` in Supabase function secrets — capture pipeline is fully functional end-to-end; he saw a Realtime card arrive in the browser.

**Wave 3 Track A audit:** Confirmed 7 of 9 dashboard migration epics already shipped in prior commits (agents, workspace items, memory, task inbox, chat sessions, slack messages, changelog). Only file browser (W3.7) remains.

**Memory feedback captured:**
- [Copy-paste commands](../../../../../.claude/projects/-Users-edmundmitchell-factory/memory/feedback_copy_paste_commands.md) — commands always standalone in their own code block
- [Action items + clickable links](../../../../../.claude/projects/-Users-edmundmitchell-factory/memory/feedback_action_items_and_links.md) — consolidate at END of every response, always clickable links

## What's decided + ready to execute

- **W3.7 = option (b)** — disable `/files` + `/api/files*` in production (no `COWORK_PATH`); keep full local dev capability (edit/write/delete). Also graceful-guard the `lib/tools.ts` agent file tool bindings in prod. Implementation ready to start.

## What's pending Edmund's decision

- **W1.3 cleanup approach.** Re-audit done:
  - 5 of 12 tools already deleted on remote by the agents-first refactor
  - 5 actively used by new agent roles (record_decision, record_learning, file_reader, file_writer, system_heartbeat) — MUST NOT delete
  - 2 maybe-dead: `notion_sync` (stub), `recalibrate_pinecone` (unwired feedback loop)
  - Local commit `5d32f83` CANNOT push (conflicts; would break the refactor)
  - Edmund to pick: **drop+defer** (recommended — drop the stale commit, defer micro-cleanup to W9.4) / **drop+micro** (drop stale, make a new ~40-line cleanup of notion_sync + maybe recalibrate_pinecone) / **leave** (divergence sits until W9.4)

## Next epics autonomous work can pursue

| Epic | What |
|---|---|
| W3.7 execution | Implement option (b) — ~30 min. |
| W4.4 | YouTube ingest Edge Function port — transcript → chunk → embed → `memory`. Port from `/Users/edmundmitchell/factory/reference/reference-repos/gravityclaw/tools/youtube_ingest.py`. |
| W4.5 | Signals ingest Edge Function port — RSS + Gemini summary + score + dual-write. Fix missing-namespace bug. |
| W4.1 | Lev agent (voice + ingest) — `/agents/lev/identity.md` + `CLAUDE.md`. |
| W4.2 | Voice memo capture path in `capture()` — audio upload → Storage → Whisper transcribe → treat as text capture. |

Full backlog (9 waves, ~40 epics, status-marked): [backlog.md](backlog.md).

## Operating mode

- Charter + backlog at the top of `06-handoffs/`.
- Work top-to-bottom, pick next unblocked `⚪` item.
- Additive Supabase migrations allowed without per-epic check-in; destructive SQL is a hard stop.
- Edge Function deploys to the `capture` slot or new names are fine.
- Local dashboard dev server runs on port 3000 (pid varies); check with `lsof -i :3000`.

## Key IDs and URLs

- **Supabase project:** `obizmgugsqirmnjpirnh`
- **Supabase function secrets:** https://supabase.com/dashboard/project/obizmgugsqirmnjpirnh/functions/secrets
- **Dashboard local:** http://localhost:3000
- **Capture endpoint:** `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture`
- **Pinecone index (retiring):** `gravity-claw`
- **GravityClaw repo (retiring):** `/Users/edmundmitchell/factory/reference/reference-repos/gravityclaw/` (real code); `/Users/edmundmitchell/gravityclaw/` = empty cache

## Ready-to-paste prompt for the next session

Scroll to the top of this file — the whole prompt you need is two paragraphs long.
See the "Ready-to-paste prompt" below.
