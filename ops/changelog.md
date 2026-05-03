# Factory changelog

## 2026-05-03 (latest) — Cost routing via OpenRouter (rev 3 plan)

Cut LLM spend on Edge Functions by routing low-stakes tasks to Haiku and keeping Sonnet for review/synthesis.

- New shared picker: `supabase/functions/_shared/models.ts` — `pickModel(task)` + `assertAllowed(id)` allowlist guard (`anthropic/`, `openai/`, `google/gemini-` only) + env overrides `MODEL_CHEAP/MID/STRONG`.
- `curator_pass` is now two-stage: Haiku drafts (sees source data) → Sonnet reviews against an explicit ID allow-list (no source data). Adds JSON shape validation + one stricter retry, deterministic schema validation (kebab-case skill_name, non-empty body/rationale, no fake refs), and `notes` records `draft → reviewed → inserted (dropped …) | draft_model=… review_model=…`. Dry-run still calls both LLMs but inserts zero. Model ids also written into `skill_versions.metadata`.
- `mixture` voters → `[Haiku, Sonnet, Haiku]`; synthesizer Sonnet. Model selection moved inside the request handler (env changes take effect on next request). Caller-supplied `body.models`/`body.synth_model` validated against the allowlist (`model_id_disallowed` 400 on violation). Server-side `console.log({mixture_voter})` per voter + `{mixture_synth}` for synth.
- `delegate` → `pickModel("summarize")` for OpenRouter, `pickFallback()` (`gpt-4o-mini`) for OpenAI fallback. Logs `{delegate_model}`.
- Dashboard: single line in `dashboard/supabase/functions/_shared/llm.ts` — `cheap` tier flipped from `openai/gpt-4o-mini` to `anthropic/claude-haiku-4-5`. 5 importers redeployed (processor-run, contradiction-scan, permanent-gate, researcher-run, research-director-synthesis).
- Approved model list (locked): `anthropic/claude-haiku-4-5` (cheap), `anthropic/claude-sonnet-4-6` (mid), `anthropic/claude-opus-4-7` (strong). OpenRouter accepts both hyphen and dot version separators (verified). OpenAI fallback: `gpt-4o-mini`.
- Plan: `ops/plans/2026-05-03-cost-routing.md`. Estimated savings $150–300/mo. Out of scope: dashboard chat (`lib/anthropic.ts`), agent-runner main loop, audio transcription, signal classification.

## 2026-05-03 (later) — Phases 5 + 6 + 7 + polish + Lev path

**B-batch polish:**
- /inbox/[id] detail page: wired CaptureActions (Ask Cordis / Post Slack / Copy) above the descriptive panel
- /inbox/promotions: thin curator-runs status strip (last run, items examined, next-run hint)
- / : "captures today" tile linking to /inbox
- /inbox row: line-clamp-3 so long pastes don't push other rows off-screen
- Migration 029: codified `agent_conversations` as canonical, `sessions`+`agent_messages` as supporting (resolves Phase 1's loose-end ticket)

**C — voice-memo Lev path:** drop-zone now accepts mp3/m4a/wav/webm/ogg → /api/inbox/voice → Whisper transcript → kind=voice work_log row. focus.md priority #3 first leg shipped (drag any audio onto /inbox; auto-transcribed).

**A5 — delegate Edge Function:** server-side subroutine registry that returns one summary string. v1 tasks: `summarize_recent_captures`, `triage_pending_promotions`, `ingest_status_digest`. Wired into dashboard `lib/tools.ts` so any retrieve-capable agent can call `delegate({task: ...})`. Deliberately NOT arbitrary eval (service-role key risk); each task is auditable.

**A6 — mixture-of-agents Edge Function:** fans a question to N OpenRouter models (Claude/GPT-4o/Gemini default) in parallel, runs synthesis pass, returns one consolidated answer with provenance in `votes`. Server-side equivalent of the three-brain skill. Wired as `mixture` tool.

**A7 — full-duplex voice mode at `/voice`:** browser-only stack — Web Speech API for STT, SpeechSynthesis for TTS, existing `/api/chat` SSE endpoint for the agent loop. Sentence-by-sentence speech as the reply streams. Added to sidebar; surface map updated.

**Sidebar drift system:** sync-agents.mjs now parses sidebar.tsx navItems and warns if any path is missing from `_shared/dashboard-surfaces.md`. Added /voice row to shared file; resynced all 8 user-facing agents.

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
