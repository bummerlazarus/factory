# Plan — Option A: Agent Infrastructure Polish

**Date:** 2026-04-18
**Branch:** `feat/agent-infra-polish` (off `feat/department-workspace-overhaul`)
**Triad:** (1) tool-tag filtering · (2) doc-sync admin endpoint · (3) persistent wake queue
**Closes:** Asks C, D-automation, E from yesterday's agent verification.

## Context

Yesterday's end-to-end verification (see `04-audit/2026-04-18-agent-verification-tests.md`) found three real gaps:

- **Ask E — Tool filtering by tag is unenforced.** Master roster declares per-agent tool tags (`factory`, `business`, `delivery`, etc.) but `lib/anthropic.ts:145` and `lib/agent-runner.ts:178` hand every agent the full FILE/WORKSPACE/COMMUNICATION tool sets. Hild can `write_file`; scope enforcement is vibes, not mechanism.
- **Ask C — Wake-up on mention is fire-and-forget.** `/api/slack/route.ts` uses `after()` and calls `canRunAgent()`; if the agent is on cooldown (30s) or at concurrency cap (3), the wake is silently dropped. No queue, no retry.
- **Ask D follow-up — iCloud→DB doc sync is manual.** `scripts/import-agents-from-icloud.mjs` requires SSH to a machine with both iCloud and `SUPABASE_SERVICE_ROLE_KEY`. No endpoint, no button.

## Task 1 — Tool tag filtering

### Design

Tool tags live in `COWORK_PATH/Agent Personalities/README.md` as a markdown table. Eight agents × 1–2 tags each. Union them into tool groups:

| Tag           | Tool groups granted                               |
|---------------|---------------------------------------------------|
| `factory`     | file, workspace, communication                    |
| `business`    | workspace, communication                          |
| `strategy`    | workspace, communication, approval                |
| `social`      | workspace, communication                          |
| `content_ops` | workspace, communication                          |
| `design`      | workspace, communication                          |
| `delivery`    | workspace, communication                          |
| `companion`   | workspace, communication                          |

Unknown / missing tags → `workspace, communication` (safe default — read/write shared brain + talk, no filesystem, no approvals).

Net effect:
- **Axel** (`factory`) → +FILE. Unchanged vs today.
- **Tokamak** (`business, strategy`) → +APPROVAL. Unchanged vs today (id-gate kept as belt-and-suspenders).
- **Hild** (`business, design`) → no FILE. **Gap closed.**
- **Kardia, Corva, Lev, Feynman, Cordis** → no FILE. Shared-brain tools only.

### Changes

1. **Migration** `20260418110000_agents_tool_tags.sql` — additive column:
   ```sql
   alter table public.agents
     add column if not exists tool_tags text[] not null default '{}';
   ```
2. **Import script** `scripts/import-agents-from-icloud.mjs` — parse the `Tool Tags` column from the README roster (robust to whitespace); include `tool_tags` in the upsert payload.
3. **Types** `types/index.ts` — add `toolTags: string[]` to the `Agent` interface.
4. **Loader** `lib/agents.ts` — map `tool_tags` db column → `toolTags`.
5. **New module** `lib/agent-tools.ts`:
   ```ts
   export function toolsForAgent(agent: Agent): Anthropic.Tool[]
   ```
   Single source of truth. Applies the tag → group mapping, unions, returns deduped tool array. Includes id-fallback for `ceo` → approval tools (keep until migration verified).
6. **Call sites** — replace inline tool arrays in `lib/anthropic.ts:145` and `lib/agent-runner.ts:178` with `toolsForAgent(agent)`.

### Acceptance

- Seed run of import script writes non-empty `tool_tags` for all eight agents.
- Unit-style check: `toolsForAgent(<hild-agent>).map(t => t.name)` does NOT include `write_file` / `delete_file` / `move_file` / `rename_file` / `create_directory`.
- `toolsForAgent(<axel-agent>)` DOES include those five.
- `toolsForAgent(<tokamak-agent>)` includes `approve_task`, `reject_task`, `escalate_task`.
- Existing chat session with Axel still produces expected tool usage (happy path unregressed).

## Task 2 — Doc-sync admin endpoint

### Design

Wrap the import script's core as a library function and expose it via `POST /api/admin/sync-agents`. Add a sidebar button at the bottom (below `ThemePicker`) that calls it with toast feedback.

### Changes

1. **Refactor** `scripts/import-agents-from-icloud.mjs` logic into `lib/agent-sync.ts` exporting `syncAgentsFromIcloud({ dry })` → `{ agents: [...], upserted: n, totalInDb: n }`. The .mjs script becomes a thin CLI wrapper that imports and calls the library. (Scripts run as Node, library must not import Next-only things.)
2. **New route** `app/api/admin/sync-agents/route.ts` — `POST` calls the lib function; returns JSON summary. `GET` → 405. Auth: reuses Supabase service-role on server; no new auth surface.
3. **New component** `components/admin/sync-agents-button.tsx` — "Sync agents from iCloud" button, POSTs, renders `"Synced 8 agents"` toast on success, error on failure. Disabled when `COWORK_PATH` env is unset (check via a tiny `GET /api/admin/sync-agents/status`).
4. **Sidebar** `components/layout/sidebar.tsx` — slot the button under `SlackButton` and above `ThemePicker`. Hidden when collapsed.

### Acceptance

- `curl -X POST http://localhost:3000/api/admin/sync-agents` returns `{ upserted: 8, totalInDb: 8 }`.
- Click from sidebar shows success toast and the DB reflects current disk state (verify by editing an agent's `CLAUDE.md`, clicking, re-reading via `/api/agents`).
- Endpoint is a no-op safe to call repeatedly (idempotent via upsert).
- If `COWORK_PATH` unset at runtime: endpoint returns 409 with clear error; sidebar button disabled.

## Task 3 — Persistent wake queue

### Design

Three layers:

- **Enqueue** — `/api/slack` writes a row to `agent_wake_queue` for every mention. Keep the existing `after()` call as the immediate best-effort drain for zero-latency happy case; but the queue row is the ground truth.
- **Drain** — New `drainWakeQueue()` helper in `lib/wake-queue.ts`. Fetches up to N oldest pending rows, for each: check `canRunAgent`; if allowed, mark `processing`, await `wakeUpAgent`, mark `done`; if not, leave `pending` for next tick (attempts++). Retry cap at 10 attempts → `failed`.
- **Triggers for drain:**
  1. Called at the end of every `wakeUpAgent` completion (natural — whenever any agent finishes, check the queue). Replaces the existing in-memory `pendingWakeUps` drain.
  2. Vercel cron `*/1 * * * *` as safety net via `/api/cron/drain-wake-queue`. 1-minute cadence is acceptable; if an agent ran within 60s, layer-1 will have drained already.

### Schema

```sql
create table public.agent_wake_queue (
  id              uuid primary key default gen_random_uuid(),
  agent_id        text not null,
  trigger_type    text not null,        -- 'slack_mention' | 'tool_queued' | 'cron'
  trigger_ref     text,                 -- slack message id or similar
  channel         text,
  trigger_message text not null,
  status          text not null default 'pending'
                    check (status in ('pending','processing','done','failed')),
  attempts        int not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz,
  updated_at      timestamptz not null default now()
);

create index agent_wake_queue_pending_idx
  on public.agent_wake_queue (status, created_at)
  where status in ('pending','processing');

create index agent_wake_queue_agent_status_idx
  on public.agent_wake_queue (agent_id, status);

alter table public.agent_wake_queue enable row level security;
create policy "edmund reads queue" on public.agent_wake_queue
  for select using (auth.email() = 'edmund.j.mitchell@gmail.com');
create policy "service role writes queue" on public.agent_wake_queue
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
```

### Changes

1. **Migration** `20260418111000_agent_wake_queue.sql` — above.
2. **Lib** `lib/wake-queue.ts`:
   - `enqueueWake(params)` — inserts a pending row.
   - `drainWakeQueue({ maxRows })` — processes pending rows; respects `canRunAgent`; calls `wakeUpAgent`; updates status.
3. **Update** `app/api/slack/route.ts` — `enqueueWake(...)` per mention before the `after()` call; `after()` kept as fast-path.
4. **Update** `lib/agent-runner.ts` — replace the in-memory `pendingWakeUps` drain block at line 252 with `await drainWakeQueue({ maxRows: 5 })`. The in-memory `pendingWakeUps` queue from tools can stay but should also call `enqueueWake` so tool-originated waits are persistent too.
5. **New route** `app/api/cron/drain-wake-queue/route.ts` — GET/POST → calls `drainWakeQueue({ maxRows: 20 })`; returns JSON summary.
6. **Vercel cron** `vercel.json` — add `{ path: "/api/cron/drain-wake-queue", schedule: "*/1 * * * *" }`.

### Acceptance

- Insert fake pending row → hit the cron endpoint → row goes `done`, `wakeUpAgent` ran (check `agent_activity_log` or equivalent).
- Fire 5 rapid `@mention` messages at Kardia → first wakes immediately, next 4 queued → observe queue drain as cooldowns release. **No silent drops.**
- Test failure path: seed a row with a bogus `agent_id` → drain marks it `failed` with `last_error`.
- Ensure idempotency: a `done` row is never re-processed (WHERE `status = 'pending'` filter).

## Execution order

Sequential, one commit each:

1. **Task 1** — tool filtering. Lowest blast radius (pure logic refactor + one migration). Commit msg: `feat: tool-tag filtering for agent runtimes`.
2. **Task 2** — doc-sync endpoint. Depends on Task 1's import-script refactor. Commit: `feat: doc-sync admin endpoint + sidebar button`.
3. **Task 3** — wake queue. Independent of 1 and 2. Commit: `feat: persistent agent wake queue + cron drain`.

Single PR at the end against `feat/department-workspace-overhaul`.

## Verification gate (final, before merge)

- All three migrations applied cleanly to live Supabase (additive only — charter-allowed).
- `npm run build` + `npm run lint` clean.
- Manual smoke: sidebar sync button works; a Slack mention enqueues + drains; Hild cannot `write_file`.
- Run log at `06-handoffs/autonomous-runs/2026-04-18-option-a-agent-infra.md` with pasted verification output.

## Out of scope (flagged, not done)

- Rate-limiting on the admin sync endpoint (Edmund-only surface; low risk).
- Moving `ceo` approval tools off id-gate to pure tag-gate (kept as safety net for now).
- UI for viewing `agent_wake_queue` rows (`/admin/queue` page) — defer until first real use reveals if needed.
- Scope docs enrichment (5 placeholders) — Edmund content.
