# Factory changelog

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
