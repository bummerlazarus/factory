# Plan — Slack/Comms channel @-mention reliability fixes

**Created:** 2026-05-03
**Owner:** Claude Code (autonomous build)
**Verifier:** Codex (`git diff | codex exec ...`)
**Repo:** `dashboard/` (Vercel project `dashboard`)

---

## Problem (observed)

Edmund tags agents with `@axel`, `@cordis`, `@designer` in #general and gets no response.

`agent_wake_queue` table evidence (queried 2026-05-03):

| Pattern | Rows | Implication |
|---|---|---|
| 8 recent slack_mention rows from today, `status=pending`, `attempts=0` | many | Drain never claimed them |
| One zombie row from 2026-04-22 (`agent_id=edmundmitchell`), `attempts=9`, `last_error="Agent not found"` | 1 | Wastes attempts, sits at queue head |
| 5+ hour gap between drain runs (06:48 → 11:38) on a `* * * * *` cron | — | Cron is not actually firing every minute |
| `processed_at` set only on a tiny minority of rows | — | Drain reliability is the bottleneck |

Confirmed wiring (already in place, not the issue):
- `lib/slack.ts:postMessage` enqueues a wake per `@mention` ✅
- `app/api/slack/route.ts` runs `after(() => drainWakeQueue(...))` ✅
- `vercel.json` has `* * * * *` cron at `/api/cron/drain-wake-queue` ✅
- `lib/wake-queue.ts` claims rows, calls `wakeUpAgent`, marks `done`/`failed`/`pending` ✅

## Root causes (ranked)

1. **Drain head-of-line blocking.** `drainWakeQueue` orders `created_at ASC` and the inline `after()` drain in `/api/slack` uses `maxRows = mentionedAgents.length` (often 1). The zombie 2026-04-22 row keeps getting picked first — every new mention drain processes the zombie, not the new mention. The cron's batch of 20 *should* sweep them all, but doesn't (see #2).
2. **Vercel cron isn't firing minutely** (or fires inconsistently). On Hobby it would be daily-only; on Pro `* * * * *` is allowed but free crons can be deprioritized. Either way, the dashboard depends on it as its safety net and the safety net is unreliable. Need an additional drain trigger that's not Vercel cron.
3. **Bad-mention rows poison the queue.** `@EdmundMitchell` and any unknown handle currently fail in `wakeUpAgent` (returns `{status:"failed"}`) and increment attempts up to MAX_ATTEMPTS=10 before being marked `failed`. They should be terminally failed on the *first* "Agent not found" — there's no recovery from a missing agent.
4. **No user-visible feedback** when a mention can't be resolved. The user types `@notarealagent`, gets nothing, no clue why.
5. **Mention resolution is name-only.** A user typing `@tokamak` (the display name) works because the DB fallback does `ilike name`. But a user typing `@ceo` (the canonical id) also works. There's no alias table — typos like `@cordi` silently fail. Acceptable for now but worth a single-source-of-truth alias map.

## Goals (this build)

1. Mentions to **valid** agents result in a reply within ~30s, every time.
2. Mentions to **invalid** handles fail loudly (visible system message in the channel) on first attempt and stop blocking the queue.
3. The drain is no longer dependent on a single Vercel cron timer.
4. Operational visibility: a small admin endpoint to inspect `agent_wake_queue` health.

## Non-goals (deferred)

- Replacing the wake queue with realtime/streams.
- Slack-style typing indicators or read receipts.
- Cross-channel routing rules.
- Rich `@here`/`@channel` semantics.

---

## Build steps (v2 — post-Codex)

Codex flagged: cleanup must use full resolution (not just `id`), system replies can loop, validation must fail-open, head-of-line blocking needs a fresh-first drain, drainWakeQueue's pre-claim cooldown check uses the un-resolved alias, and `processing` rows can stick. All addressed below.

Each step is small, reviewable, and ends with a verification command.

### Step 0 — Add a shared `agentExists(handle)` helper

**File:** `dashboard/lib/agents.ts`

```ts
/** Returns canonical id for a handle (id, name case-insensitive), or null. Cheap, cached for 30s. */
export async function resolveAgentHandle(handle: string): Promise<string | null> { ... }
```

This is the same logic as `resolveAgentId` but with an in-memory 30s LRU so we can call it cheaply from `slack.postMessage` without N round-trips per message. Used by Steps 2, 4, and the drain pre-claim check (Step 7).

### Step 1 — Make bad mentions terminally fail (queue hygiene)

**File:** `dashboard/lib/wake-queue.ts`

- In the catch path *and* in the `wakeUpAgent` failure path, detect `error?.startsWith("Agent not found:")` (and the matching skipped-from-runner case where the error message comes back as the same string). When matched, mark the row `status='failed'` immediately regardless of `attempts`.
- Bonus: add a small `terminal_errors` array at module scope; iterate to keep the predicate readable.

**File:** `dashboard/lib/agent-runner.ts:wakeUpAgent`

- When `resolveAgentId(agentId)` returns null, prefix the error with `Agent not found:` (it already does — keep the contract explicit with a comment).

**Verify:**

```bash
# Insert a synthetic bad row, drain once, assert it's failed not pending
psql ... -c "INSERT INTO agent_wake_queue(agent_id,trigger_type,trigger_message) VALUES ('nope-agent','manual','test');"
curl -X POST http://localhost:3000/api/cron/drain-wake-queue
# (Earlier drafts of this plan pointed at https://dashboard-nine-delta-26.vercel.app — wrong app. The dashboard is local-only.)
psql ... -c "SELECT status, attempts, last_error FROM agent_wake_queue WHERE agent_id='nope-agent';"
# Expect: status=failed, attempts=1
```

### Step 2 — Drop the head-of-line zombie + clean up legacy poison rows

**File:** `dashboard/scripts/cleanup-wake-queue.mjs` (new)

- For each `pending` row, call `resolveAgentHandle(row.agent_id)`. **Use the same resolution path as the runner** (id OR case-insensitive name) so we don't fail valid `axel`/`hild` rows whose canonical id is `developer`/`designer`.
- Mark unresolved rows `status='failed', last_error='cleanup: handle does not resolve'`.
- Also fail any pending row with `attempts >= MAX_ATTEMPTS`.
- Defaults to `--dry-run`. Requires `--apply` to write.

**Run once** with `--apply` after Step 1 ships.

**Verify (run from `dashboard/`):**

```bash
node scripts/cleanup-wake-queue.mjs               # dry-run, prints what would change
node scripts/cleanup-wake-queue.mjs --apply       # writes
# Then:
psql ... -c "SELECT count(*) FROM agent_wake_queue WHERE status='pending';"
# Expect: 0 (or only very recent valid rows)
```

### Step 3 — Targeted-first drain (fix head-of-line) + extra trigger

Codex flag: enlarging the inline drain still drains oldest-first, so a fresh mention can sit behind older rows. Fix is two-part:

**3a. Add `drainSpecific(rowIds: string[])` to `lib/wake-queue.ts`** — same claim/process logic, but selects only the given ids. This drains the just-inserted rows immediately regardless of queue head.

**File:** `dashboard/lib/wake-queue.ts`

**3b. Use it from `/api/slack` POST.** After `postMessage` returns, capture the wake row ids it enqueued (refactor: `postMessage` now returns `{message, wakeIds}` OR a parallel `enqueueWakesForMessage` exported helper). Hand those ids to `drainSpecific` inside `after()`. THEN, opportunistically, also call `drainWakeQueue({maxRows: 5})` to sweep older valid rows. New mentions never wait behind a poisoned head.

**File:** `dashboard/app/api/slack/route.ts`, `dashboard/lib/slack.ts`

**3c. Drain on chat completion already exists** in `agent-runner.ts` — keep.

**3d. Add a one-line client-side tick from the dashboard.** Once per 60s, while a tab is open, fetch `/api/cron/drain-wake-queue` (existing, accepts GET, drains 20). Independent of the existing 5s slack-panel read-poll. Works whether or not Vercel cron fires.

**File:** new `dashboard/components/system/wake-queue-pinger.tsx` mounted in the dashboard root layout. Single-flight: skip if a previous tick is still in flight.

**Verify:**

```bash
# 1. With the dashboard closed, post a mention via curl. See it answered after the next Vercel cron tick or after dashboard is opened — whichever comes first.
# 2. With the dashboard open, post a mention. See it answered within ~30s (no waiting on cron).
# 3. Insert a synthetic poisoned-head pending row, then post a real mention. The real mention should be answered first.
```

### Step 4 — Surface unresolved mentions in-channel (loop-safe)

**File:** `dashboard/lib/slack.ts:postMessage`

- After computing `mentionedAgents`, call `resolveAgentHandle(name)` per name (Step 0 helper).
- **Resolved** → enqueue wake (existing path).
- **Unresolved** → do NOT enqueue. Insert a system message into the channel with `type='system'` and a content string that does NOT contain `@` (use `[name]` instead): `"⚠️ No agent matches [{name}]. Try: cordis, axel, hild, lev, ..."`.
- **Loop guard:** skip mention extraction + the unresolved-validation path entirely when `opts.type === 'system'`. (Codex flag: otherwise the system reply re-extracts `@` and recurses.) Add a unit-test-style assertion: posting `@notarealagent` results in exactly ONE system message, not N.
- **Fail-open:** if `resolveAgentHandle` throws (DB blip), default to the existing behavior (enqueue), so transient lookup errors never silently swallow a valid mention.

**Verify:**

```bash
curl -X POST http://localhost:3000/api/slack \
  -d '{"channel":"general","content":"@notarealagent ping","agent":"human"}' \
  -H content-type:application/json
# Expect:
#   - a single system message in #general: "⚠️ No agent matches [notarealagent]. Try: ..."
#   - no row in agent_wake_queue with agent_id='notarealagent'
#   - re-running 5x results in 5 system messages, NOT 25 (no recursion)

curl -X POST http://localhost:3000/api/slack \
  -d '{"channel":"general","content":"@axel ping","agent":"human"}' \
  -H content-type:application/json
# Expect: wake row enqueued for resolved canonical id (developer)
```

### Step 5 — Health endpoint + stuck-row recovery

**File:** `dashboard/app/api/admin/wake-queue-health/route.ts` (new)

Returns JSON derived only from columns we actually have:
```json
{
  "pending": 3,
  "oldestPendingAgeSec": 12,
  "processing": 0,
  "oldestProcessingAgeSec": null,
  "lastSuccessfullyProcessedAt": "2026-05-03T12:34:00Z",  // max(processed_at)
  "failedLast24h": 2,
  "topPendingAgents": [{"agent_id":"cordis","count":2}]
}
```
(Codex flag: there's no drain-run log, so don't pretend `lastSuccessfulDrainAt` exists — use `max(processed_at)` and label it accordingly.)

**Stuck-row recovery — File:** `dashboard/lib/wake-queue.ts`

At the top of `drainWakeQueue`, before fetching pending rows: any row stuck in `status='processing'` for >5 minutes gets flipped back to `pending` (or `failed` if attempts >= MAX_ATTEMPTS). One UPDATE, no per-row cost. Prevents permanent stuck rows from a crashed/torn-down invocation.

**Verify:**

```bash
curl http://localhost:3000/api/admin/wake-queue-health | jq .
# Manually set a row to status='processing' with updated_at=now() - 10min, hit drain, observe row reverts to pending.
```

### Step 6 — Resolve handle BEFORE the cooldown check (alias-aware drain)

**File:** `dashboard/lib/wake-queue.ts:drainWakeQueue`

Codex flag: `canRunAgent(row.agent_id)` runs against the raw mention (`axel`), but the runner uses canonical id (`developer`) for the actual cooldown/concurrency tracking. Two consecutive `@axel` rows can both pass the pre-claim check and then fight inside the runner.

Fix: resolve `row.agent_id` once via `resolveAgentHandle` *before* `canRunAgent`. Use the canonical id for both the cooldown check and the eventual `wakeUpAgent` call. If resolution fails → mark row `status='failed'` immediately (Step 1's terminal-fail path).

**Verify:**

```bash
# Insert two pending rows with agent_id='axel' a second apart, drain.
# Expect: first runs, second deferred on cooldown for 'developer' (canonical), not both racing.
```

### Step 7 — End-to-end verification (must pass before merge)

```bash
# 1. Post 3 mentions in fast succession (mix of canonical id + display name)
for handle in cordis axel hild; do
  curl -X POST http://localhost:3000/api/slack \
    -d "{\"channel\":\"general\",\"content\":\"@${handle} respond please\",\"agent\":\"human\"}" \
    -H content-type:application/json
done

# 2. Wait 90s (covers cooldown stagger), then check the queue
sleep 90
psql ... -c "SELECT agent_id, status, attempts FROM agent_wake_queue WHERE created_at > now() - interval '5 minutes' ORDER BY created_at;"
# Expect: all status=done, attempts=1, agent_id stored as the value the runner ran (canonical preferred but raw acceptable as long as it resolved)

# 3. Check replies — agents post under their canonical id, so check those
psql ... -c "SELECT agent, content FROM slack_messages WHERE created_at > now() - interval '5 minutes' AND agent IN ('cordis','developer','designer') ORDER BY created_at;"
# Expect: at least one message from each of cordis, developer, designer

# 4. Negative case
curl -X POST http://localhost:3000/api/slack \
  -d '{"channel":"general","content":"@notarealagent hi","agent":"human"}' \
  -H content-type:application/json
sleep 5
psql ... -c "SELECT type, content FROM slack_messages WHERE channel='general' ORDER BY created_at DESC LIMIT 3;"
# Expect: most recent is type='system' content includes 'No agent matches [notarealagent]'
psql ... -c "SELECT count(*) FROM agent_wake_queue WHERE agent_id='notarealagent';"
# Expect: 0
```

---

## Risk + blast radius

- All changes are dashboard-only. Worst case: a buggy validation regression silently swallows mentions. Mitigation: keep the existing wake-enqueue path, ADD validation as a guard, never remove the existing happy path until E2E passes.
- The cleanup script is one-time; gate behind a `--dry-run` default and require `--apply` to write.
- No DB migrations needed. (Optional: an index on `agent_wake_queue (status, created_at)` if drain is slow — defer until measured.)

## Push strategy

- `dashboard` auto-deploys to Vercel from `main`. Do NOT commit per step to `main` — that would publish intermediate UI/API state to prod.
- Work on feature branch `slack-mentions-reliability`. Commit per step there.
- After Step 7 (E2E) passes locally AND a Vercel preview deploy of the branch passes the same E2E, fast-forward `main` to the branch tip and push once.
- No PR — Edmund prefers commit liberally + push at end of session.

## Codex blockers — resolved in this revision

| Blocker (Codex) | Resolved by |
|---|---|
| Cleanup script would fail valid `axel`/`hild` rows | Step 0 + Step 2 use shared `resolveAgentHandle` (id OR ilike name) |
| Step 4 system reply could recurse on its own `@` | Step 4: skip mention extraction when `type='system'`; reply uses `[name]` not `@name`; assertion in verify |
| Step 4 could swallow valid mentions on transient errors | Step 4: fail-open — if resolve throws, fall through to existing enqueue path |
| Inline drain still oldest-first (head-of-line blocking) | Step 3a: new `drainSpecific(rowIds)` runs the just-inserted rows by id |
| Inline drain enlargement adds latency | Step 3b: targeted drain runs first; opportunistic sweep is a separate after() call |
| Pre-claim cooldown checks raw alias | Step 6: resolve handle before `canRunAgent`; canonical id used everywhere |
| `processing` rows can stick forever | Step 5: stuck-row recovery (>5 min processing → reset/fail) |
| `lastSuccessfulDrainAt` not in schema | Step 5: renamed `lastSuccessfullyProcessedAt` = `max(processed_at)` |
| Step 6 verify mismatch (cordis/axel/hild → cordis/developer/designer) | Step 7: explicit note that runner posts under canonical id; queries updated |
| Verify commands had wrong cwd | All `node` commands now relative to `dashboard/` |

## Codex review prompt (paste at end)

```bash
git diff origin/main...HEAD -- dashboard/ | codex exec --skip-git-repo-check \
  "Review this slack-mention reliability change. Look for: (1) bugs in queue ordering or status transitions, (2) silent swallow of valid mentions, (3) race conditions between the inline drain and the cron drain, (4) any place where 'Agent not found' could now be terminal for a *valid* agent (e.g. archived or transient lookup failure). Report blockers vs. nits."
```

---

## Ready-to-paste autonomous-execution prompt

> Execute the plan at `ops/plans/2026-05-03-slack-mentions-autonomous-build.md`. Work step-by-step, committing after each step. After Step 6 passes locally, run the Codex review prompt at the end of the plan, integrate any blocker feedback, then push to main. Do NOT open a PR. When done, post a brief summary of what shipped + what Codex flagged + what you deferred.
