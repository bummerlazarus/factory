# Slack agent loop guard C — wake-depth cap

**Repo:** `dashboard/`
**Date:** 2026-05-03
**Follow-up to:** option A (commit 7146957) — agent-to-agent wakes silenced when no human active in last 10 min.

## Problem

Two agents can ping-pong @-mentions forever even with option A active, *if* a human posts once and then leaves. Each mention enqueues a fresh wake; the existing 30s per-agent cooldown only paces the loop, doesn't end it.

## Fix

Track a **wake depth** counter through the wake chain. A human-originated wake is depth 0. Each wake's run carries a depth; if that run posts a slack message that triggers more wakes, those wakes are enqueued at `depth + 1`. Refuse to enqueue when `depth + 1 > MAX_DEPTH` (default 3).

Concretely: human → A (d=1) → B (d=2) → A (d=3) → would-be-B at d=4 is REFUSED.

## Implementation

### 1. Schema

New migration `dashboard/supabase/migrations/20260503000000_agent_wake_queue_depth.sql`:

```sql
ALTER TABLE public.agent_wake_queue
  ADD COLUMN IF NOT EXISTS wake_depth int NOT NULL DEFAULT 0;
```

Existing rows default to 0 — no backfill needed (worst case: in-flight wakes during deploy treat themselves as fresh, which is fine).

### 2. `lib/wake-context.ts` (new, ~25 lines)

```ts
import { AsyncLocalStorage } from "async_hooks";
const als = new AsyncLocalStorage<{ depth: number }>();
export function getCurrentWakeDepth(): number {
  return als.getStore()?.depth ?? 0;
}
export function runWithWakeDepth<T>(depth: number, fn: () => Promise<T>): Promise<T> {
  return als.run({ depth }, fn);
}
```

`AsyncLocalStorage` propagates across `await` boundaries and dynamic imports — standard Node API. Context survives the `Promise.all` in `lib/slack.ts:enqueueWake` calls.

### 3. `lib/wake-queue.ts` changes

- Add `wakeDepth?: number` to `EnqueueParams`. If omitted, read from `getCurrentWakeDepth()`.
- Insert with `wake_depth: depth`.
- **Refuse** when `depth > MAX_WAKE_DEPTH` (default 3): log and return `null` (same shape as a DB failure — caller already handles null).
- Add `wake_depth` to `QueueRow` interface and the `select(...)` columns.
- `runRows()`: pass `wakeDepth: row.wake_depth` to `wakeUpAgent`.

### 4. `lib/agent-runner.ts` changes

- `wakeUpAgent` accepts `wakeDepth?: number` (default 0).
- Wrap the entire run body in `runWithWakeDepth(wakeDepth, async () => { ...existing body... })` so any `enqueueWake` calls during the run inherit the depth.

### 5. `lib/slack.ts` — no change

`postMessage` calls `enqueueWake` which now reads depth from ALS automatically. The new wake row is inserted at `parentDepth + 1` because we'll have `enqueueWake` add 1 when reading from context (a fresh top-level call that explicitly passes `wakeDepth: 0` for human input means a depth-0 row → run wraps run in `runWithWakeDepth(0, ...)` → child enqueues at 1).

Wait — to be precise: `enqueueWake` should insert `wake_depth = (passedDepth ?? getCurrentWakeDepth() + 1)`. The parent's run sets context to its own depth; children stored as parent+1. Top-level calls (human input) bypass — they're at depth 0 since nothing set context.

Actually cleaner: `enqueueWake` always stores `getCurrentWakeDepth() + 1` if it's inside a run context, else 0. Most readable rule:

```
const ctxDepth = getCurrentWakeDepth();
const newDepth = ctxDepth > 0 ? ctxDepth + 1 : (params.wakeDepth ?? 0) + (params.wakeDepth !== undefined ? 0 : 0);
```

Simpler: top-level enqueues outside any wake context → depth 0. Enqueues inside a wake run → parent depth + 1. The `params.wakeDepth` override is unused for now (kept as escape hatch).

Final rule: `wake_depth = isInsideWakeRun() ? getCurrentWakeDepth() + 1 : 0`.

### 6. Constants

```ts
const MAX_WAKE_DEPTH = 3;
```

Tuneable. With the cap at 3: human → A → B → A is allowed; B replying after that is muted.

## Done criteria

- Migration applies cleanly (one column, default 0).
- Human posts `@cordis` in #marketing → cordis runs → cordis posts `@hild` → hild wake enqueued at depth 2 (yes, depth=1 for cordis's run, child at 2).
- After 3 hops the next would-be wake is refused; logged, no insertion, no agent runs.
- Existing agent-to-agent wakes when no human is active are still suppressed by option A.
- Type-check + manual SQL probe: `SELECT MAX(wake_depth) FROM agent_wake_queue WHERE created_at > NOW() - INTERVAL '1 hour';` should never exceed 3.

## Risks

- AsyncLocalStorage doesn't survive `setTimeout`/`setImmediate` without explicit binding. We don't use timers between agent run start and enqueueWake — call chain is `wakeUpAgent → executeTool → post_slack_message tool → postMessage → enqueueWake`. All `await`-connected. Safe.
- `Promise.all` in slack.ts: each `enqueueWake` runs concurrently in tasks spawned within the same ALS context. ALS is task-aware. Safe.
- Vercel Edge runtime: `async_hooks` is available on Node serverless functions; the cron and slack routes are Node by default in Next.js 16. Confirm by grepping for `runtime = 'edge'` in the relevant routes.

## Out of scope

- Per-channel rate limiting (option B) — not needed if A + C both ship.
- Adjusting MAX_WAKE_DEPTH dynamically per channel.
- Surfacing the refusal as a system message in-channel (might re-introduce noise).
