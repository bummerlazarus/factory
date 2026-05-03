# Factory changelog

## 2026-05-03 — Phases 2 + 3 + 4 (rev B) shipped

**Phase 2 — Curator nudges.** Migration 028 adds `curator_runs` log + nightly pg_cron job (3am Central) that calls the new `curator_pass` Edge Function. Corva reads the last 24h of `work_log` + `ingest_runs` + `agent_conversations`, asks Claude (via OpenRouter) for 0–3 well-grounded skill proposals, writes them as `skill_versions` rows with `status='proposed'`. First real proposal landed (`7ed6568a-…`, youtube-ingest v2) with cited ingest_run IDs. Edmund sees them at `/inbox/promotions`.

**Phase 3 — Skills self-improvement.** New `ops/bin/promote-skill.mjs` (zero-dep, fetch-based) reads an approved `skill_versions` row and writes its body to `~/.claude/skills/<name>/SKILL.md`, then git-commits if `~/.claude` is a repo (skipped gracefully otherwise). Wired into `dashboard/app/api/promotions/route.ts` so Approve in the UI now updates disk in one click. Verified end-to-end: approving the Phase 2 proposal updated the on-disk youtube-ingest SKILL.md (added the `youtube-scribe` fallback section); Claude Code's skill list confirmed the new content loaded.

**Phase 4 (rev B) — Dashboard capture surface.** Original "multi-platform messaging gateway" framing dropped (would have added external surfaces, not the goal). Replaced with three additions to the dashboard `/inbox` page:
- `/api/inbox/text` route — POSTs text → `capture()`, auto-routes pure URLs to `kind=url` for Firecrawl enrichment.
- `<QuickCaptureBar>` component at the top of `/inbox` — always-visible textarea, Enter to capture, paste-image triggers the existing file-upload pipeline.
- `<InboxDropZone>` — page-wide drop zone activates when files are dragged anywhere on `/inbox`.

Smoke-tested: `curl POST /api/inbox/text` with plain text → `kind=text` capture; with a Wikipedia URL → `kind=url` Firecrawl-enriched; both rows visible in `work_log`.

Loose-end ticket from Phase 1 (registry vs reality drift) still open.

## 2026-05-03 — Phase 1: cross-session search

- Migration 027 adds `agent_conversations.messages_fts` (trigger-maintained tsvector + GIN index), `search_chat_history()` RPC restricted to `service_role`, and a `session_search` row in `intent_router`.
- `route_query` Edge Function v3 dispatches `session_search` server-side via the new RPC. New body params: `agent_filter`, `since`.
- `dashboard/lib/tools.ts`: added `session_search` to the `retrieve` tool's intent list (description + input_schema). No new tool — existing `retrieve` covers it.
- Built on `agent_conversations` (registry says `legacy`, but it is the only chat table being actively written — `sessions`+`agent_messages` are stale since 2026-04-19). Drift filed as loose-end ticket `4e4d863f-4a39-4dc3-b14b-dd7d30a815f7` in `agent_tasks`.
- Note: route_query's plan returns `primary_tables: []` for this intent (because `agent_conversations` is `legacy` in the registry); `results` populates correctly. Resolves when the loose-end ticket is acted on.
- Try it: in any chat with `retrieve`, `retrieve({intent: 'session_search', query: '<keyword>'})`.
- Plan: `ops/plans/2026-05-03-phase-1-cross-session-search.md`. Roadmap: `ops/plans/2026-05-03-hermes-inspired-roadmap.md`.

## 2026-05-03 — Phase 0: always-running dashboard (documented)

- Already shipped before this session: `~/Library/LaunchAgents/com.edmund.dashboard.plist` keeps `npm run dev` alive on `localhost:3000` (RunAtLoad + KeepAlive). Wrapper at `ops/bin/dashboard-dev.sh`. Logs at `ops/logs/dashboard.{out,err}.log`.
- Documented in `ops/docs/dashboard-launchd.md` with start/stop/tail/uninstall commands and the fnm node-version gotcha.
- Maps to `ops/focus.md` priority #1.
