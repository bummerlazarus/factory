# Hermes-Inspired Build — Master Roadmap

**Date:** 2026-05-03
**Source:** Comparison of [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) against Edmund's stack (`reference/reference-repos/hermes-agent/` for source).
**Status:** Re-scoped 2026-05-03 after code review. Edmund picked items 1, 3, 2, 4, 7, 6, 10 from the Hermes feature comparison, in execution order: 1 → 3 → 2 → 4 → 7 → 6 → 10. Added Phase 0 (always-running dashboard via launchd) per `ops/focus.md` priority #1, which the original roadmap missed. **Phases 5, 6, 7 deferred to a post-90-day list** — they don't ladder to focus.md priorities and risk distracting from the loop that does.

---

## Why this roadmap exists

`ops/focus.md` (drafted 2026-05-03) names three priorities for the next 90 days: dashboard-as-primary-surface, capture→promotion loop firing daily, voice-memo path first-class. Most of the Hermes-inspired items below directly serve those priorities — they are not net-new agents but extensions of the existing troupe (Cordis, Corva, Lev). Where this roadmap conflicts with `focus.md`, focus.md wins.

| Phase | Maps to focus.md priority | Owning agent | Status |
|---|---|---|---|
| **0 — Always-running dashboard (launchd)** | **#1 (dashboard as primary surface)** | infra | **Active** |
| 1 — Cross-session search | #2 (promotion loop needs prior-session recall) | reuse `retrieve` tool | Active |
| 2 — Curator nudges | #2 (proactively surfaces things to promote) | Corva | Active |
| 3 — Skills self-improvement loop | #2 (the actual loop endgame) | Corva + skill_versions | Active |
| 4 — Multi-platform messaging gateway | #1, #3 (more capture entry points) | Lev / capture() | Active |
| ~~5 — Subagent RPC pattern~~ | doesn't ladder to focus.md | — | **Deferred (post-90-day)** |
| ~~6 — Mixture-of-agents tool~~ | doesn't ladder to focus.md | — | **Deferred (post-90-day)** |
| ~~7 — Voice mode (full-duplex)~~ | focus.md #3 is voice-memo *capture*, not full-duplex chat | — | **Deferred (post-90-day)** |

---

## Sequencing logic

0. **Phase 0 (launchd) first** because focus.md priority #1 is "dashboard as primary surface" and that's blocked by "you forgot to run `npm run dev`." Half-day work, unblocks everything.
1. **Cross-session search next** because every later phase wants it (curator queries past sessions, skill self-improvement reads use-history, gateway needs cross-platform thread continuity). 1-day build.
2. **Curator nudges** reuses #1's plumbing and immediately produces visible value (Edmund opens dashboard, sees proposed promotions he didn't ask for).
3. **Skills self-improvement** is the biggest north-star payoff but needs #1 + #2 first because it triggers off of "we used skill X and here's how it could improve."
4. **Gateway** is medium-effort, unlocks more captures, runs independently of #1–#3.
5. **Subagent RPC** is internal cleanup — collapses ingest pipelines. Done once it has clear users (post-#4).
6. **Mixture-of-agents** is polish on the three-brain skill. Low priority.
7. **Voice mode** is the most speculative; ships only if focus.md #3 still warrants it after the voice-memo path is solid.

---

## Per-phase briefs

Each brief has its own detailed implementation plan written when its turn comes. The brief defines scope, files, success criteria, and ~5 tasks. The detailed plan adds full TDD steps with code blocks.

---

### Phase 0 — Always-running dashboard (launchd)

**Goal:** `localhost:3000` is always live on Edmund's laptop. Starts on login. Restarts on crash. Survives a reboot. Logs are tailable.

**Plan file:** [`ops/plans/2026-05-03-phase-0-launchd-dashboard.md`](2026-05-03-phase-0-launchd-dashboard.md).

**Files to touch:**
- Create: `~/Library/LaunchAgents/com.edmund.factory-dashboard.plist`
- Create: `ops/bin/dashboard-launchd.sh` (small wrapper that `cd`s, sets PATH, runs `npm run dev`)
- Create: `ops/docs/dashboard-launchd.md` (how to start/stop/tail/uninstall in plain language)

**Success criteria:**
- After `launchctl load ...`, `curl localhost:3000` returns 200.
- Reboot the laptop → `localhost:3000` is live within 60s of login, no manual action.
- Kill the `next dev` process → it's back within 10s.
- `tail -f /tmp/factory-dashboard.{out,err}.log` shows live output.

**Out of scope:** mobile (focus.md scope is laptop-only this window); Vercel prod (already running).

---

### Phase 1 — Cross-session search

**Goal:** Add a `session_search` intent to the existing `retrieve` tool so any Claude session (or agent that has `retrieve`) can call `retrieve({intent: 'session_search', query: '...'})` and get back ranked excerpts from past chat conversations with session_id, agent, date, and snippet.

**Plan file:** [`ops/plans/2026-05-03-phase-1-cross-session-search.md`](2026-05-03-phase-1-cross-session-search.md) — full TDD plan, ready to execute.

**Reviewer-driven changes (2026-05-03):**
- Build on `agent_conversations` (currently the only table with fresh writes — `sessions` + `agent_messages` haven't been written since 2026-04-19 despite the registry marking them canonical). File a loose-end ticket to resolve the drift.
- Use a **trigger-maintained tsvector column** (not a generated column) so we can use `jsonb_array_elements` to extract clean text instead of JSON-quoted blobs.
- **Restrict RPC to `service_role` only** (Edge Function calls it with the service key); never grant to `anon`.
- **No new dashboard tool** — `retrieve` already exists and routes to `route_query`. Just add `session_search` to its intent list.

**Files to touch:**
- Create: `supabase/migrations/027_session_search_fts.sql` — `tsvector` column + trigger + backfill on `agent_conversations`, GIN index, `search_chat_history(q, top_k, agent_filter, since)` RPC, `intent_router` seed.
- Modify: `supabase/functions/route_query/index.ts` — add `session_search` dispatch case.
- Modify: `dashboard/lib/tools.ts` lines 489–528 — append `session_search` to `retrieve` tool's intent enumeration in description and the input_schema's `intent` description.

**Success criteria:**
- In a Claude Code session, calling `retrieve({intent: 'session_search', query: 'voice memo'})` returns ranked excerpts.
- Each result has session_id, persona_id (agent), updated_at, rank, and a highlighted excerpt.
- Latency <500ms on the current ~25-row corpus (verified via `EXPLAIN ANALYZE`).
- `route_query`'s in-source comment lists `session_search`.

**Out of scope:** vector/semantic search (FTS only — 90% as useful at 0% the cost); UI for browsing results (results render in chat); LLM summarization of results (Phase 1.5 if needed).

---

### Phase 2 — Curator nudges

**Goal:** Nightly scheduled task (Claude Code Cron) where Corva reviews the last 24h of `ingest_runs` + `agent_conversations` and writes proposed promotions to `inbox_items` with `kind='proposed_promotion'`. Edmund sees them in `/inbox/promotions` next morning. No promotion is auto-applied.

**Files to touch:**
- Create: `ops/bin/curator-nightly.sh` — invokes Corva via Edge Function with prior-day window.
- Create: `supabase/functions/curator_pass/index.ts` — Edge Function that pulls 24h window, calls Anthropic API with Corva's prompt, writes proposals.
- Create: `supabase/migrations/028_inbox_proposed_promotion_kind.sql` — extend `inbox_items.kind` enum/check.
- Modify: `dashboard/app/inbox/promotions/` — render `proposed_promotion` rows with approve/reject (likely already supports promotions; verify schema match).
- Cron: register a daily 3am task via `mcp__scheduled-tasks__create_scheduled_task`.

**Success criteria:**
- Each morning, `/inbox/promotions` has ≥0 (often ≥1) new proposals from Corva.
- Each proposal cites the source rows (session_id, ingest_run_id) it was built from.
- Approval writes a `skill_versions` row + commits to `skills/` (this part already exists; verify wiring).

**Open questions to resolve before plan-writing:** does `inbox_items` already accept Corva-authored rows? Is there a working approve→`skill_versions` path today, or does Phase 3 need to build it?

---

### Phase 3 — Skills self-improvement loop

**Goal:** Close the loop: when a skill runs in a session (detected via slash-command or skill mention), at session-end Corva proposes a diff to that skill's `skill_versions` row at `status='proposed'`. Edmund's approval in `/inbox/promotions` flips it to `status='active'` and writes a new version row. Disk + Notion sync follow the existing 3-place convention.

**Files to touch:**
- Create: `supabase/migrations/029_skill_usage_log.sql` — `public.skill_usage` table (skill_name, session_id, used_at, outcome).
- Modify: `dashboard/lib/agent-runner.ts` — log skill mentions into `skill_usage` mid-session.
- Modify: `supabase/functions/curator_pass/index.ts` (from Phase 2) — extend to read `skill_usage`, propose diffs.
- Create: `ops/bin/promote-skill.mjs` — given a `skill_versions` proposal id, write disk file under `~/.claude/skills/<name>/SKILL.md`, commit, also write Notion via MCP.
- Modify: `dashboard/app/inbox/promotions/route.ts` — on approve, call promote-skill mjs.

**Success criteria:**
- Closing a session that used `/three-brain` produces (often) a Corva proposal: "based on this session, three-brain skill could add example X / clarify rule Y."
- Approving in `/inbox/promotions` produces (a) new `skill_versions` row, (b) updated disk SKILL.md, (c) git commit, (d) Notion entry update — all in one click.

**Out of scope:** auto-promotion (always human-in-loop); cross-skill refactors (one skill at a time per proposal).

---

### Phase 4 — Multi-platform messaging gateway

**Goal:** A single Vercel-hosted endpoint that accepts inbound messages from Telegram, Slack DM, iPhone Shortcut, and Email-to-webhook, normalizes them into `capture()` calls, and routes responses back to the originating platform with a stable `thread_id` so cross-platform conversation continuity works.

**Files to touch:**
- Create: `dashboard/app/api/gateway/[platform]/route.ts` — handler per platform (telegram, slack, shortcut, email).
- Create: `dashboard/lib/gateway-normalize.ts` — platform-specific payload → unified `{platform, user, text, thread_ref}` shape.
- Modify: `supabase/functions/capture/index.ts` — accept `thread_id` and platform in payload; persist on `inbox_items`.
- Create: `supabase/migrations/030_gateway_threads.sql` — `public.gateway_threads` mapping (platform, platform_thread_id) → internal `thread_id`.
- Notion / docs: `ops/docs/gateway-platforms.md` — credentials, webhook URLs, allowed-user lists.

**Success criteria:**
- Send a Telegram message to the bot → row in `inbox_items` within 2s, response back to same Telegram thread.
- Same `thread_id` reachable from a Slack message later in the same conversation, response continues there.
- Failed deliveries land in `agent_tasks` with `[gateway-failure]` prefix, not silently dropped.

**Out of scope:** Discord, WhatsApp, Signal (only the four Edmund actually uses); voice (handled in Phase 7); WeChat (HermesClaw exists for that).

**Risk:** The prior Telegram-on-Railway attempt failed. Mitigation: this runs on Vercel as part of dashboard, no separate hosting.

---

---

## Deferred phases (post-90-day list)

The following were in the original roadmap but don't ladder to `ops/focus.md`'s three priorities. They stay in this doc as future inspiration, not as scheduled work. Re-evaluate at the 90-day check.

### Phase 5 — Subagent RPC pattern

**Goal:** Replace today's "shell-script-per-ingest" pattern with a `delegate(script, tools)` tool that lets a Claude session hand off a Python or Node script that calls Supabase + Anthropic + Firecrawl tools internally, returning only a summary to the calling context. Eliminates the 10k-token-per-30KB context burn for multi-step ingests.

**Files to touch:**
- Create: `supabase/functions/delegate/index.ts` — Deno runtime that runs sandboxed JS with bound clients (supabase, anthropic, firecrawl).
- Create: `dashboard/lib/agent-tools.ts` registers `delegate` tool.
- Migrate: rewrite `ops/bin/ingest-youtube.sh` as a delegate script as the proof-point.

**Success criteria:**
- A session asks "ingest this YouTube playlist (50 videos)" → one `delegate` tool call → playlist ingests, only summary lands in context.
- Token usage on caller side is ≤2k regardless of payload size.

**Out of scope:** arbitrary Python (Deno-only for v1); long-running jobs >5min (use scheduled tasks instead).

---

### Phase 6 — Mixture-of-agents tool

**Goal:** Extend the existing `three-brain` skill into a tool that fans a query out to N models (Claude, GPT-5, Gemini), runs an aggregator pass, and returns one consolidated answer with provenance.

**Files to touch:**
- Create: `dashboard/lib/mixture-of-agents.ts` — fan-out logic with model-specific clients.
- Create: `supabase/functions/mixture/index.ts` — server-side endpoint so any agent (not just Claude Code) can call it.
- Modify: `~/.claude/skills/three-brain/SKILL.md` — document the new tool path, keep existing CLI as fallback.

**Success criteria:**
- A `mixture("design review for X", models=["claude","gpt5","gemini"])` call returns one synthesized answer plus the three raw responses.
- Used at least once a week (telemetry: log calls to `agent_messages`).

---

### Phase 7 — Voice mode (full-duplex)

**Goal:** Push-to-talk voice conversation with the dashboard. Whisper for STT, ElevenLabs (or local NeuTTS) for TTS, streaming both ways. Edmund speaks → transcript appears → agent replies in voice + text.

**Files to touch:**
- Create: `dashboard/app/voice/page.tsx` — voice UI with WebRTC audio capture.
- Create: `dashboard/app/api/voice/transcribe/route.ts` — Whisper streaming proxy.
- Create: `dashboard/app/api/voice/synthesize/route.ts` — TTS streaming proxy.
- Modify: `dashboard/lib/agent-runner.ts` — already streams text; route TTS as a parallel stream.

**Success criteria:**
- Hold-to-talk on `/voice` → real-time transcript → response in <2s start-of-audio.
- Voice transcripts also land in `inbox_items` (voice memos kept as captures).

**Out of scope:** wake-word detection; mobile (focus.md scope is laptop-only this window); offline mode.

**Decision gate:** Before starting Phase 7, re-evaluate against `focus.md`. If voice-memo capture (the simpler Lev path from focus #3) has already proven the value, voice mode may be deferred.

---

## Cross-cutting conventions (apply to every phase)

- **Migrations** numbered sequentially from 027 onward.
- **Edge Functions** follow the `route_query` pattern: `x-capture-secret` header, `verify_jwt=false`, in-source doc comment at top.
- **Agent allowlists** edited on disk (iCloud `agent personalities/`), then `node ops/bin/sync-agents.mjs`.
- **Skills writes** hit all three locations (disk, `skill_versions`, Notion) per CLAUDE.md.
- **Loose ends** discovered during work → `agent_tasks` with `[loose-end]` prefix per `ops/docs/loose-ends.md`.
- **Decisions** that change architecture → `archive/architecture-rebuild-2026-04-17/03-decisions/decisions-log.md` (or wherever the active decisions log lives — verify before writing).
- **Each phase ends with**: passing tests, a commit, and a 1-paragraph entry in `ops/changelog.md` (create if absent).

---

## How to run this autonomously

For each phase in order:
1. Read this brief + the prior phase's commit log.
2. Write the detailed plan (`ops/plans/YYYY-MM-DD-phase-N-<name>.md`) using `superpowers:writing-plans`.
3. Get Edmund's review of the plan.
4. Execute via `superpowers:subagent-driven-development` (one subagent per task) or inline.
5. Verify success criteria are met (run smoke test, confirm in dashboard).
6. Commit, write changelog entry, mark phase done.
7. Move to next phase.

**Stopping rules** — stop and ask Edmund if any of these happen:
- A phase's success criteria can't be verified without him (e.g. "send a Telegram message to test").
- A test fails and the fix isn't obvious within 2 attempts.
- A migration would touch a table outside `table_registry` allow scope.
- Estimated work for a phase exceeds 1 day.

---

## Changes
- **2026-05-03** — Initial roadmap. Drafted by Claude Code in a session where Edmund reviewed Hermes Agent against the current stack and chose 7 features to build. Phase 1 detailed plan written same day.
- **2026-05-03** — Re-scoped after code review: added Phase 0 (always-running dashboard via launchd) per `ops/focus.md` priority #1; deferred Phases 5/6/7 to post-90-day; reframed Phase 1 to reuse existing `retrieve` tool (no new dashboard tool); switched table-source decision to `agent_conversations` after row-count check showed registry-canonical tables are stale; flagged the registry-vs-actual drift as a loose-end ticket.
