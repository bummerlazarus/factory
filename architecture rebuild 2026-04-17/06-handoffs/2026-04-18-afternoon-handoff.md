# Handoff — 2026-04-18 afternoon

Continuation of the morning autonomous run. Edmund unblocked W7.2 scope Qs and requested verification of agent comms + Tokamak review.

## What shipped this run

| Item | Status | Notes |
|---|---|---|
| W7.2a+b — workstreams + FK refactor | 🟢 committed `0e2d171` | 6 workstreams seeded (factory/dc-clients/zpm/real-true/faith-ai/em-brand) + 9 `client-scope` reference_docs + FK on `work_log.project` and `agent_tasks.project_slug`. Naming collision: `public.projects` is a portfolio table serving edmund.dev — canonical table named `workstreams` instead. |
| W7.2c — /clients dashboard | 🟢 committed `19fbdf6` | 6 tiles with scope preview + recent captures + open tasks + drift ramp; DC-clients umbrella nests 3 sub-client mini-cards. Briefcase icon, sidebar entry slotted between Research and Changelog. |
| W7.2d — Kardia canonical SQL | 🟢 iCloud only (not git) | +34 lines net to Kardia's CLAUDE.md: 3 SQL snippets (scope-read / drift-check / observation-write) + bite-test rule + enum tightening (6 projects, 3 DC clients). |
| Agent doc sync (disk → DB) | 🟢 fixed | Confirmed drift for Kardia/Corva/Feynman; ran existing `scripts/import-agents-from-icloud.mjs`; post-sync verification confirms all three Rebuild extensions now live in Supabase. |
| Comms + tasks + Tokamak behavioral tests | 🟢 3/4 pass, 1 caught the drift bug | End-to-end Slack mention wake-up ✅; full task creation → CEO approval → agent completion loop ✅; cooldown/concurrency guards ✅; doc-sync test surfaced the gap we then fixed. |

## Commits this run (on `feat/department-workspace-overhaul`)

- `0e2d171` feat: workstreams table + client-scope vocab + FK refactor (W7.2a+b)
- `19fbdf6` feat: /clients dashboard surface (W7.2c)

## Agent verification — summary

Full reports at `04-audit/2026-04-18-agent-verification-recon.md` and `04-audit/2026-04-18-agent-verification-tests.md`.

| Ask | Status | Notes |
|---|---|---|
| A. Slack channel end-to-end | 🟢 | Send + receive + wake-up on @mention all wired. |
| B. Agent task assignment | 🟢 | Agent A → `create_agent_task` → Tokamak approval → target agent woken with task in system prompt → `complete_task` tool closes loop. |
| C. Wake-up on mention | 🟡 | Works, but fire-and-forget via `after()` hook. No persistent queue — if agent is on cooldown (30s) or at concurrency cap (3), the wake is silently skipped. Recommend: `agent_wake_queue` table + 10s drain cron. |
| D. Core docs adherence | 🟢 (post-fix) | identity.md / CLAUDE.md / soul.md all loaded in system prompt. Disk→DB drift fixed in this run; no automated sync pipeline yet, so re-run `import-agents-from-icloud.mjs` after future disk edits. |
| E. Tool filtering by tag | 🔴 | Master roster declares per-agent tool tags (e.g. Kardia=`business, delivery`), but `lib/anthropic.ts` and `lib/agent-runner.ts` hand every agent the full FILE/WORKSPACE/COMMUNICATION tool sets. Only CEO gets extra APPROVAL_TOOLS. Hild can write files; Axel can post to Slack. Scope enforcement is vibes, not mechanism. |
| F. Tokamak CEO review loop | 🟢 | `approve_task` / `reject_task` / `escalate_task` tools live on CEO only. Tasks default to `pending_approval`, gate execution until approved. Human escalation surfaces in `/tasks` UI with Slack @human alert. |

## Edmund — two things worth knowing

1. **Tonight 21:00 CT** — the daily-recap scheduled task should run unattended. If it still prompts, the Option-B migration (move recap to Supabase `daily_recaps` table) is ~30-45 min.

2. **Scope docs need your content.** 5 of 9 `client-scope` docs are placeholders flagged `metadata.needs_enrichment=true`:
   - `scope-zpm`, `scope-real-true`, `scope-faith-ai`
   - `scope-dc-clients-cfcs`, `scope-dc-clients-liv-harrison`, `scope-dc-clients-culture-project`

   Each needs: retainer terms, primary contact, known deliverables, drift-risk indicators. Without this Kardia's drift checks produce `days_quiet` numbers but can't tell you what's at risk. `scope-factory` and `scope-em-brand` already have real content.

## Open gaps — next run's starting queue

**P1 (high impact, fast):**

- **Tool tag filtering.** `lib/anthropic.ts` line 145 and `lib/agent-runner.ts` line 178 need to filter `tools` by the agent's declared tool tags. Size S (~30 min). Closes Ask E.
- **Doc-sync automation.** Wrap `import-agents-from-icloud.mjs` in a `POST /api/admin/sync-agents` endpoint + a sidebar button. Size S (~45 min). Next time anyone edits a CLAUDE.md on disk, one click syncs.

**P2 (quality-of-life, medium):**

- **Persistent wake queue.** New table `agent_wake_queue(agent_id, trigger_type, trigger_ref, status, created_at)`. `/api/slack/route.ts` writes there instead of (or in addition to) the `after()` call. Cron drains every 10s honoring concurrency/cooldown. Size M. Closes Ask C.
- **Route-level `canRunAgent` fix.** `/api/slack/route.ts` and `/api/tasks/approve/route.ts` call `canRunAgent(rawMention)` before canonicalizing — check is effectively a no-op. `wakeUpAgent` re-checks with the canonical id so behavior is correct, but tidy up. Size XS (~15 min).

**Deferred:**

- **W1.4** — dual-read parity report (needs ≥7 days of `memory_dualread_log` accumulation; not blocking).
- **IP map UI** — `/ip-map` route rendering the single `slug='ip-map'` reference_doc. Size S.
- **LLM polish on IP map** — Edge Function that rewrites sections in Edmund's voice. Size S.

## Verify over the next ~3 days

- **Tonight 21:00 CT** — `factory-daily-recap` scheduled task completes without prompt.
- **Monday 07:00–08:05 UTC** — chained crons fire: themes scan → connections scan → synthesis Edge Function → ip-map regenerate. Check `/research` and `reference_docs WHERE slug='ip-map'`.

## Uncommitted working-copy state (Edmund's, not mine)

Same as morning:
- `CLAUDE.md`, `lib/icons.ts`, `components/layout/sidebar.tsx` modified (Inbox/Promotions/Metrics nav + Inbox/Link2 icons are yours, kept intact around my commits via stash-dance)
- Untracked: `app/api/promotions/`, `app/inbox/`, `lib/supabase-browser.ts`, `data/agent-runs/`, `public/carousel-example.html`, `supabase/.temp/`

## Charter notes

- Touched `~/.claude/settings.json` and Kardia's iCloud CLAUDE.md per explicit scope authorizations.
- Additive Supabase migrations (3 this run) all pre-approved.
- Ran import script (writes to agents table) — idempotent, bounded by `upsert ON CONFLICT id DO UPDATE`.
- $10/run cap: well under. Zero OpenAI spend this run.

## Subagents dispatched this run

- W7.2a+b execution (blocked once, redirected, shipped)
- W7.2d Kardia extension (shipped)
- Verification architecture recon (comprehensive report)
- Behavioral tests (4 tests executed, cleanup confirmed)
- Doc-sync audit (surfaced drift)
- W7.2c /clients dashboard (shipped)
- Post-sync verification (confirmed drift closed)
