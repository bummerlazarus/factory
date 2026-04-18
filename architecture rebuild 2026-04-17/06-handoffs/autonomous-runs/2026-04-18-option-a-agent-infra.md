# Run — Option A: Agent Infrastructure Polish

**Date:** 2026-04-18
**Plan:** [`05-design/plans/2026-04-18-option-a-agent-infra.md`](../../05-design/plans/2026-04-18-option-a-agent-infra.md)
**Branch:** `feat/agent-infra-polish` off `feat/department-workspace-overhaul` (dashboard repo)
**Status:** 🟢 DONE — three tasks shipped, reviewed, verified; ready for PR.

## Epics closed

| Ask | Verification handoff status | This run |
|---|---|---|
| E — Tool tag filtering | 🔴 unenforced | 🟢 closed |
| C — Wake on mention (silent drops) | 🟡 fire-and-forget | 🟢 persistent queue live |
| D-automation — iCloud→DB doc-sync manual | ⚪ (P1 backlog item) | 🟢 endpoint + sidebar button |

## Commits on branch

1. `abcdfed` feat: tool-tag filtering for agent runtimes
2. `ef8be02` feat: doc-sync admin endpoint + sidebar button
3. `63b60a3` feat: persistent agent wake queue + cron drain
4. `a19b24b` fix: cap attempts on skipped drain path; wrap post-run drain in after()

## Supabase migrations applied

1. `20260418110000_agents_tool_tags` — `alter table agents add column tool_tags text[]` (applied to live project `obizmgugsqirmnjpirnh` via MCP).
2. `20260418111000_agent_wake_queue` — new table + RLS + two indexes (applied live).

Both additive, within charter ($10/run cap, no destructive ops).

## Files touched

### Task 1 — tool tag filtering
- `lib/agent-tools.ts` (new, 69 lines) — tag → tool-group mapping + `toolsForAgent()`.
- `lib/agents.ts` — map `tool_tags` db column to `toolTags` on the Agent type.
- `lib/anthropic.ts` — call `toolsForAgent(agent)` instead of union.
- `lib/agent-runner.ts` — same.
- `scripts/import-agents-from-icloud.mjs` — parse Tool Tags column from the master roster README; include in upsert.
- `types/index.ts` — add `toolTags: string[]` to `Agent`.
- `supabase/migrations/20260418110000_agents_tool_tags.sql` — migration.

### Task 2 — doc-sync endpoint
- `lib/agent-sync.ts` (new, 167 lines) — canonical sync library.
- `app/api/admin/sync-agents/route.ts` (new) — GET status, POST to run sync.
- `components/admin/sync-agents-button.tsx` (new, 85 lines) — sidebar button with states.
- `components/layout/sidebar.tsx` — slot button between SlackButton and ThemePicker.
- `lib/icons.ts` — re-export `RefreshCw`.

### Task 3 — wake queue
- `lib/wake-queue.ts` (new, 170+ lines) — `enqueueWake`, `drainWakeQueue`, MAX_ATTEMPTS=10 cap on both skipped and failed paths.
- `app/api/slack/route.ts` — enqueue per mention; `after()` drains.
- `app/api/cron/drain-wake-queue/route.ts` (new) — GET/POST endpoint for cron.
- `lib/agent-runner.ts` — drain wrapped in `after()` post-run; tool-queued wakes now enqueue persistently.
- `vercel.json` (new) — `crons: [{ path: "/api/cron/drain-wake-queue", schedule: "* * * * *" }]`.
- `supabase/migrations/20260418111000_agent_wake_queue.sql` — migration.

## Subagents dispatched

1 — `superpowers:code-reviewer` against the plan + three feature commits. Verdict: **no blockers**, two concerns fixed in `a19b24b`, three nits deferred to follow-ups.

## Verification

### Migrations — live DB
```sql
select id, name, tool_tags from public.agents order by sort_order, name;
-- cordis | Cordis  | {companion}
-- developer | Axel | {factory}
-- content | Corva  | {business,content_ops}
-- research | Feynman | {business}
-- designer | Hild  | {business,design}
-- pm | Kardia     | {business,delivery}
-- marketing | Lev | {business,social}
-- ceo | Tokamak   | {business,strategy}
```

### Task 1 behavioral — via `toolsForAgent()`
- Hild's tools exclude `write_file`, `delete_file`, `move_file`, `rename_file`, `create_directory` ✅ (tags = business+design, no `factory`).
- Axel's tools include all five FILE tools ✅ (tag = factory).
- Tokamak's tools include `approve_task`, `reject_task`, `escalate_task` ✅ (tag = strategy + id-gate belt-and-suspenders).

### Task 2 — endpoint + button round-trip
```
GET /api/admin/sync-agents
→ { available: true, coworkPath: "/Users/edmundmitchell/…/CEO Cowork" }

POST /api/admin/sync-agents?dry=true
→ { success: true, upserted: 0, totalInDb: 0, dry: true,
    agents: [{ id: "ceo", name: "Tokamak", toolTags: [business,strategy] }, …×8] }

Sidebar button click
→ state: Syncing… → "Synced 8 agents" → idle (3.5s auto-reset)
```

### Task 3 — wake queue paths
```
1. Empty drain (baseline):
POST /api/cron/drain-wake-queue
→ { processed: 0, succeeded: 0, deferred: 0, failed: 0 }

2. Retry path (bogus agent row seeded):
POST drain → row goes pending, attempts=1, last_error="Agent not found: …"

3. Terminal-fail path (attempts bumped to 9, then drained):
POST drain → row goes failed, attempts=10, last_error preserved

Test row deleted after verification.
```

## Build status

`npm run build` fails on **pre-existing** errors:
- `ops/scripts/ingest-youtube.ts:118` — null check.
- Multiple `supabase/functions/**` (Deno Edge Functions picked up by tsconfig `include: ["**/*.ts"]` even though they're Deno-runtime).

My branch has 55 type errors; parent `feat/department-workspace-overhaul` has 57 (I reduced, added zero). **Zero errors in files touched by Option A.**

Flagged as a follow-up — the tsconfig `include` glob should exclude `ops/scripts/` and `supabase/functions/` so Vercel deploys aren't blocked. Tracked in "Follow-ups" below.

## Review-pass fixes (`a19b24b`)

- **[concern]** Skipped-result rows in `drainWakeQueue` now hit the same MAX_ATTEMPTS cap as failed ones — prevents churn if `canRunAgent` repeatedly loses a race against a concurrent drainer.
- **[concern]** `drainWakeQueue` from inside `wakeUpAgent` now wrapped in `next/server` `after()` — serverless won't tear down the Promise before it settles.

## Nits left open (intentional)

| Nit | File | Decision |
|---|---|---|
| `enqueueWake` failures are console.error only, not surfaced to POST response | `lib/wake-queue.ts:13-30` | Edge case post-migration; existing log line is sufficient. Revisit if we see a real failure in logs. |
| `after()` drain in /api/slack uses `maxRows: mentionedAgents.length` — drain is global-oldest-first, could drain unrelated rows | `app/api/slack/route.ts:82` | Harmless; arguably desirable (more drain = more coverage). Comment opportunity but not a change. |
| `setTimeout` in SyncAgentsButton has no unmount cleanup | `components/admin/sync-agents-button.tsx:47-50` | React warning only; button is in the sidebar which is never unmounted during normal use. |
| Parsing regex duplicated in `lib/agent-sync.ts` + `scripts/import-agents-from-icloud.mjs` | both | Cross-ref comment already in both files. Accept duplication vs build-time coupling. |

## Follow-ups (new backlog candidates)

**P1**
- **tsconfig cleanup.** Exclude `ops/scripts/`, `supabase/functions/` from `include` glob so `npm run build` passes on Vercel. Unblocks W9.5 (prod deploy). Size XS.

**P2**
- **Admin /queue page.** Read-only UI listing `agent_wake_queue` rows w/ status filters. Useful once real usage reveals patterns. Size S.
- **Move ceo approval from id-gate to pure tag-gate.** Plan kept id-gate as belt-and-suspenders; tighten once tool-tag filtering has run for a few weeks without issue. Size XS.

**P3**
- **Cron cadence sanity check.** `vercel.json` uses `* * * * *` (every minute). Confirm Vercel tier supports 1-min crons when dashboard ships; drop to `*/5` if not.

## Edmund — action items

- [ ] Review branch `feat/agent-infra-polish` in [github.com/bummerlazarus/factory](https://github.com/bummerlazarus/factory) once pushed.
- [ ] Decide: PR now against `feat/department-workspace-overhaul`, or bundle with W2.2b/W5.8 follow-ups first?
- [ ] Merge-blocker to flag: `npm run build` broken on parent too; tsconfig follow-up needed before Vercel prod deploy (W9.5).

## Cost

Supabase: 2 migrations (additive). No spend.
Anthropic: Code-reviewer subagent ≈ 70k tokens + orchestration thinking ≈ 50k. Under $1/run.
OpenAI: zero.

## What's next

- Option A P1/P2 from afternoon handoff: **all three shipped**.
- Up next (Edmund's taste): **Option B — voice memo capture path (W4.2)** or **tsconfig cleanup + W9.5 prod deploy prep**.
