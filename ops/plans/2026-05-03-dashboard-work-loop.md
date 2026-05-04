# Dashboard Work Loop — Autonomous Build Plan (v2)

> **For agentic workers:** Execute phase by phase. After each phase: run the verification commands, run `npm run build` and `npm run lint` from `dashboard/`, then commit. Use `superpowers:executing-plans` for inline execution. Steps use `- [ ]` checkboxes.

**v2 changes (vs. v1, after Codex review):** Full DB column lists in Pre-flight. Phase order reordered: identity hardening (was Phase 6) ships first, aging cron merged into triage (was Phase 7). Phase 4 reduced to `new_skill` + `pattern_observation` only (`update_sop` deferred). All placeholders replaced with full code. Idempotency enforced via unique partial indexes + `on conflict do nothing`. Phase 2 verification rewired through the API. `npm run build` runs after every phase.

**Goal:** Wire the Inbox / Workspace / Agent Tasks / Files surfaces into a closed work loop where agents propose, Edmund approves, agents execute, and the system records and surfaces progress in one "Today" view. Make agents able to safely and proactively help.

**Architecture:** Reuse `public.proposals` (migration 033) as the universal proposal queue with new `kind` values. Reuse `public.work_log` as the activity stream. Add one view (`work_loop_today_v`), one new helper module, two cron handlers, one page (`/today`), and three new tools. No new tables.

**Tech stack:** Next.js 16, Supabase Postgres, TypeScript, Anthropic Claude API.

---

## Pre-flight — canonical schema (verified live 2026-05-03)

Source: `information_schema.columns` query against project `obizmgugsqirmnjpirnh`. Use exactly these column names. ID type matters — note `agent_tasks.id` is `text`, all other primary IDs are `uuid`.

### `public.agent_tasks`
| Column | Type | Null |
|---|---|---|
| id | text | NO |
| from_agent | text | NO |
| from_name | text | YES |
| from_emoji | text | YES |
| to_agent | text | NO |
| title | text | NO |
| description | text | NO |
| status | text | NO |
| priority | integer | NO (1=highest, 4=lowest) |
| result | text | YES |
| approved_by | text | YES |
| rejected_by | text | YES |
| rejection_reason | text | YES |
| project_slug | text | YES |
| execution_duration_ms | integer | YES |
| retry_count | integer | YES |
| created_at | timestamptz | NO |
| updated_at | timestamptz | NO |
| completed_at | timestamptz | YES |

Status values seen: `pending_approval`, `approved`, `rejected`, `in_progress`, `completed`, `failed`.

### `public.workspace_items`
| Column | Type | Null |
|---|---|---|
| id | uuid | NO |
| slug | text | NO (unique) |
| title | text | NO |
| type | text | NO (`plan` / `project` / `task` / `scope`) |
| department | text | NO (`factory` / `marketing` / `design` / `strategy` / `general`) |
| status | text | NO (`active` / `in_progress` / `done` / `blocked` / `archived`) |
| owner | text | YES |
| content | text | NO |
| tags | text[] | NO |
| project_id | text | YES |
| risk | text | YES |
| target_files | text[] | YES |
| out_of_scope | text[] | YES |
| time_budget | text | YES |
| created_at | timestamptz | NO |
| updated_at | timestamptz | NO |

TS interface uses camelCase. Conversion helpers: `dbRowToItem` and `saveWorkspaceItem` in `dashboard/lib/workspace.ts`. **Always go through `saveWorkspaceItem` for writes.**

### `public.work_log`
| Column | Type | Null |
|---|---|---|
| id | uuid | NO |
| session_id | uuid | YES |
| project | text | YES |
| kind | text | NO (seen: `note`, `research`, `retro`) |
| summary | text | NO |
| artifacts | jsonb | NO (array; default `[]`) |
| created_at | timestamptz | NO |

No status column. Use `artifacts` for tags like completion markers.

### `public.proposals` (the universal queue)
| Column | Type | Null |
|---|---|---|
| id | uuid | NO |
| kind | text | NO |
| target_agent_id | text | YES |
| target_skill_name | text | YES |
| payload | jsonb | NO |
| status | text | NO (`proposed` / `live` / `rejected`) |
| rationale | text | YES |
| source_refs | jsonb | NO (default `[]`) |
| proposed_at | timestamptz | NO |
| approved_at | timestamptz | YES |
| approved_by | text | YES |
| materialized_at | timestamptz | YES |
| materialized_target_id | uuid | YES |

Existing kinds materialized: `persona-edit`, `memory-entry` (in `dashboard/app/api/promotions/proposal/route.ts`). New kinds added by this plan: `triage_capture`, `new_skill`, `pattern_observation`, `workspace_item`. **`materialized_target_id` is uuid** — leave NULL when materializing into `agent_tasks` (id is text).

Existing indexes: pkey, `(status, proposed_at DESC)`, `(kind, status)`, `(target_agent_id, status)`.

### `public.artifact_links`
| Column | Type | Null |
|---|---|---|
| id | uuid | NO |
| workspace_item_id | uuid | NO |
| reference_doc_id | uuid | YES |
| disk_path | text | YES |
| created_at | timestamptz | NO |
| created_by | text | YES |

Polymorphic: exactly one of `reference_doc_id` or `disk_path` set. Helpers: `linkReferenceDocToWorkspaceItem`, `linkDiskPathToWorkspaceItem` in `dashboard/lib/artifact-links.ts`. Real disk paths only — do not use synthetic schemes.

### `public.reference_docs`, `public.skill_versions`
Both have `id uuid`. Used as `materialized_target_id` for `new_skill` proposals. (Inserts not in this plan — Phase 4 reuses the existing skill_versions flow.)

### `public.agent_wake_queue`
Cron pattern reference only — see `dashboard/app/api/cron/drain-wake-queue/route.ts:*` for bearer-auth shape.

### `Agent` (TS type, `dashboard/types/index.ts:1`)
Camelcase: `id, name, role, emoji, accentColor, identityMd, claudeMd, soulMd, domainKeywords, toolTags, sortOrder, archived`. DB row → type conversion in `dashboard/lib/agents.ts:56`. **Use `toolTags`** (camelCase) when reading from `getAgent()`.

---

## Stale doc to correct in Phase 1

`dashboard/CLAUDE.md` line ~12 says "Workspace items (plans/projects/tasks/scopes) and inbox file blobs are still on disk in `COWORK_PATH`." That stopped being true in Phase 2 (April 2026). Trust the DB. Replace this sentence in Phase 1.7.

---

## Phase order and dependencies (v2)

| # | Phase | Depends on | Why this order |
|---|---|---|---|
| 1 | Agent identity hardening | — | Lands first so triage-created tasks (Phase 3) can't bypass it |
| 2 | "Today" view (`/today`) | 1 | Page that surfaces everything else |
| 3 | Loop closure on task completion | 2 | Completed tasks → work_log + workspace note |
| 4 | Triage agent + aging (merged) | 2, 3 | Auto-propose dispositions for new and stale captures |
| 5 | Self-improvement proposals (`new_skill`, `pattern_observation`) | 4 | Reuses approval surface + dispatch |
| 6 | Workspace-item gating via proposals (opt-in) | 5 | Last because it changes a tool contract |

Each phase ships independently and is revertable.

---

## Phase 1 — Agent identity hardening

**Goal:** Server-side assertion that every `createTask` call's `from_agent` and `to_agent` are real agent IDs. Audit existing callers.

**Files:**
- Modify: `dashboard/lib/task-inbox.ts` (around line 28, function `createTask`)

### Step 1.1 — Audit existing callers

- [ ] Run: `cd /Users/edmundmitchell/factory/dashboard && grep -rn "createTask(" --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.test\."`
- [ ] Confirm every caller passes `fromAgent` from a server-side trusted source (request context or config), not from user-supplied JSON. Document the call sites in the commit message.

### Step 1.2 — Add server-side assertion

- [ ] In `dashboard/lib/task-inbox.ts`, modify `createTask` to validate IDs before insert. Replace the function body's insert section with:

```typescript
export async function createTask(opts: {
  fromAgent: string;
  fromName?: string;
  fromEmoji?: string;
  toAgent: string;
  title: string;
  description: string;
  priority?: number;
  projectSlug?: string;
}): Promise<AgentTask> {
  // Validate both agent IDs exist before insert.
  const { data: agents, error: agentsErr } = await supabase
    .from("agents")
    .select("id")
    .in("id", [opts.fromAgent, opts.toAgent]);
  if (agentsErr) throw new Error(`agent lookup failed: ${agentsErr.message}`);
  const known = new Set((agents ?? []).map((a) => a.id as string));
  // 'triage' and 'system' are allowed pseudo-senders even if not in agents table
  // (see Phase 4 triage cron). They cannot be receivers.
  const ALLOWED_PSEUDO_SENDERS = new Set(["triage", "system"]);
  if (!known.has(opts.fromAgent) && !ALLOWED_PSEUDO_SENDERS.has(opts.fromAgent)) {
    throw new Error(`unknown from_agent: ${opts.fromAgent}`);
  }
  if (!known.has(opts.toAgent)) {
    throw new Error(`unknown to_agent: ${opts.toAgent}`);
  }

  const id = randomUUID();
  const { data, error } = await supabase
    .from("agent_tasks")
    .insert({
      id,
      from_agent: opts.fromAgent,
      from_name: opts.fromName,
      from_emoji: opts.fromEmoji,
      to_agent: opts.toAgent,
      title: opts.title,
      description: opts.description,
      status: "pending_approval",
      priority: opts.priority ?? 3,
      project_slug: opts.projectSlug,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return dbRowToTask(data!);
}
```

### Step 1.3 — Verify

The repo is TypeScript — there's no `lib/task-inbox.js`. Use `tsx` for a one-off check, or hit the existing API. Both options shown:

- [ ] **Option A — tsx one-off (preferred for unit-level proof):**

```bash
cd /Users/edmundmitchell/factory/dashboard
npx tsx --env-file=.env.local -e "
import { createTask } from './lib/task-inbox';
(async () => {
  try {
    await createTask({ fromAgent: 'definitely-not-real', toAgent: 'axel', title: 'x', description: 'x' });
    console.error('FAIL: should have thrown'); process.exit(1);
  } catch (e) {
    if (String(e.message).includes('unknown from_agent')) {
      console.log('OK: rejected bad from_agent');
    } else {
      console.error('FAIL: wrong error:', e.message); process.exit(1);
    }
  }
})();
"
```

- [ ] **Option B — through the API:** identify the existing route that creates tasks (`grep -rn "createTask(" app/api/`), POST a request with a bogus `fromAgent`, confirm the response is a 4xx with an "unknown from_agent" error message.
- [ ] Confirm `npm run build` and `npm run lint` are clean.
- [ ] **Commit:** `chore(tasks): assert agent ids exist before createTask insert`

---

## Phase 2 — "Today" view

**Goal:** One page at `/today` with three lanes: Needs You, In Flight, Recently Shipped. Pulls from `agent_tasks`, `workspace_items`, `proposals` (all kinds), `work_log`.

**Files:**
- Create: `dashboard/supabase/migrations/20260503100000_work_loop_today_view.sql`
- Create: `dashboard/lib/today.ts`
- Create: `dashboard/app/api/today/route.ts`
- Create: `dashboard/app/today/page.tsx`
- Create: `dashboard/app/today/today-client.tsx`
- Modify: `dashboard/components/layout/sidebar.tsx` (add Today nav above Inbox)
- Modify: `dashboard/CLAUDE.md` (correct workspace storage claim)

### Step 2.1 — Migration: `work_loop_today_v`

- [ ] Create the migration file with this complete body:

```sql
-- 20260503100000_work_loop_today_view.sql
-- Single read-only view that the /today page consumes.
-- Lanes: needs_you | in_flight | recently_shipped

create or replace view public.work_loop_today_v as
  -- Pending agent tasks → needs_you (aged flag at 14 days)
  select
    'agent_task'::text       as source,
    'needs_you'::text        as lane,
    t.id::text               as id,
    t.title                  as title,
    t.description            as detail,
    t.from_agent             as actor,
    t.priority               as priority,
    t.project_slug           as project_slug,
    t.created_at             as occurred_at,
    jsonb_build_object(
      'to_agent', t.to_agent,
      'status', t.status,
      'aged', t.created_at < now() - interval '14 days'
    ) as meta
  from public.agent_tasks t
  where t.status = 'pending_approval'

  union all
  -- Pending proposals → needs_you
  select
    'proposal',
    'needs_you',
    p.id::text,
    coalesce(p.target_skill_name, p.target_agent_id, p.kind),
    coalesce(p.rationale, p.kind),
    coalesce(p.target_agent_id, 'system'),
    3,
    null::text,
    p.proposed_at,
    jsonb_build_object('kind', p.kind)
  from public.proposals p
  where p.status = 'proposed'

  union all
  -- Approved-but-not-materialized proposals from last 7d → recently_shipped
  select
    'proposal',
    'recently_shipped',
    p.id::text,
    coalesce(p.target_skill_name, p.target_agent_id, p.kind),
    coalesce(p.rationale, p.kind),
    coalesce(p.target_agent_id, 'system'),
    3,
    null::text,
    coalesce(p.approved_at, p.proposed_at),
    jsonb_build_object('kind', p.kind, 'final_status', p.status)
  from public.proposals p
  where p.status in ('live', 'rejected')
    and coalesce(p.approved_at, p.proposed_at) >= now() - interval '7 days'

  union all
  -- In-flight tasks
  select
    'agent_task',
    'in_flight',
    t.id::text,
    t.title,
    t.description,
    t.to_agent,
    t.priority,
    t.project_slug,
    coalesce(t.updated_at, t.created_at),
    jsonb_build_object('status', t.status)
  from public.agent_tasks t
  where t.status in ('approved', 'in_progress')

  union all
  -- Active workspace items (projects/plans/tasks not done/archived)
  select
    'workspace_item',
    'in_flight',
    w.id::text,
    w.title,
    coalesce(w.content, ''),
    coalesce(w.owner, 'unassigned'),
    case w.status when 'in_progress' then 2 else 3 end,
    w.slug,
    w.updated_at,
    jsonb_build_object('type', w.type, 'department', w.department, 'status', w.status)
  from public.workspace_items w
  where w.status in ('active', 'in_progress')
    and w.type in ('project', 'plan', 'task')

  union all
  -- Recently shipped: completed tasks (last 7d)
  select
    'agent_task',
    'recently_shipped',
    t.id::text,
    t.title,
    coalesce(t.result, t.description),
    t.to_agent,
    t.priority,
    t.project_slug,
    t.completed_at,
    jsonb_build_object('status', t.status)
  from public.agent_tasks t
  where t.status = 'completed'
    and t.completed_at >= now() - interval '7 days'

  union all
  -- Recently shipped: workspace items moved to done (last 7d)
  select
    'workspace_item',
    'recently_shipped',
    w.id::text,
    w.title,
    coalesce(w.content, ''),
    coalesce(w.owner, 'unassigned'),
    3,
    w.slug,
    w.updated_at,
    jsonb_build_object('type', w.type, 'status', w.status)
  from public.workspace_items w
  where w.status = 'done'
    and w.updated_at >= now() - interval '7 days';

grant select on public.work_loop_today_v to anon, authenticated, service_role;
```

- [ ] Apply: `cd /Users/edmundmitchell/factory/dashboard && supabase db push` (uses `SUPABASE_ACCESS_TOKEN` from `.env.local`).
- [ ] Verify: MCP `execute_sql` → `select lane, count(*) from public.work_loop_today_v group by lane;`

### Step 2.2 — `dashboard/lib/today.ts`

```typescript
import { supabase } from "./supabase";

export type TodayLane = "needs_you" | "in_flight" | "recently_shipped";
export type TodaySource = "agent_task" | "proposal" | "workspace_item";

export interface TodayItem {
  source: TodaySource;
  lane: TodayLane;
  id: string;
  title: string;
  detail: string;
  actor: string;
  priority: number;
  projectSlug: string | null;
  occurredAt: string;
  meta: Record<string, unknown>;
}

export async function getTodayItems(): Promise<TodayItem[]> {
  const { data, error } = await supabase
    .from("work_loop_today_v")
    .select("*")
    .order("priority", { ascending: true })
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    source: r.source as TodaySource,
    lane: r.lane as TodayLane,
    id: String(r.id),
    title: r.title as string,
    detail: (r.detail as string) ?? "",
    actor: r.actor as string,
    priority: r.priority as number,
    projectSlug: (r.project_slug as string) ?? null,
    occurredAt: r.occurred_at as string,
    meta: (r.meta as Record<string, unknown>) ?? {},
  }));
}
```

### Step 2.3 — `dashboard/app/api/today/route.ts`

```typescript
import { NextResponse } from "next/server";
import { getTodayItems } from "@/lib/today";

export async function GET() {
  try {
    const items = await getTodayItems();
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
```

### Step 2.4 — `dashboard/app/today/page.tsx`

```typescript
import TodayClient from "./today-client";
import { getTodayItems } from "@/lib/today";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const items = await getTodayItems();
  return <TodayClient initialItems={items} />;
}
```

### Step 2.5 — `dashboard/app/today/today-client.tsx`

- [ ] Create the client component. Use existing `Card` and `Button` from `dashboard/components/ui/`. Show three sections (Needs You / In Flight / Recently Shipped). Each item has a link based on source:
  - `agent_task` → `/tasks#<id>`
  - `proposal` → `/inbox/promotions#<id>`
  - `workspace_item` → `/workspace#<projectSlug>` (the projectSlug column carries the slug for workspace items)

- [ ] Within each lane, items are already sorted by the API (priority asc, occurredAt desc). Render in that order.
- [ ] If `meta.aged === true`, show a small "stale" badge.
- [ ] Add a "Refresh" button that re-fetches `/api/today` and replaces state.

```typescript
"use client";
import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { TodayItem } from "@/lib/today";

const LANES: Array<{ key: "needs_you" | "in_flight" | "recently_shipped"; label: string; tone: string }> = [
  { key: "needs_you", label: "Needs you", tone: "border-red-300" },
  { key: "in_flight", label: "In flight", tone: "border-blue-300" },
  { key: "recently_shipped", label: "Recently shipped", tone: "border-zinc-200 opacity-70" },
];

function hrefFor(it: TodayItem): string {
  switch (it.source) {
    case "agent_task": return `/tasks#${it.id}`;
    case "proposal": return `/inbox/promotions#${it.id}`;
    case "workspace_item": return it.projectSlug ? `/workspace#${it.projectSlug}` : "/workspace";
  }
}

export default function TodayClient({ initialItems }: { initialItems: TodayItem[] }) {
  const [items, setItems] = useState<TodayItem[]>(initialItems);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const r = await fetch("/api/today");
      const j = await r.json();
      if (j.ok) setItems(j.items as TodayItem[]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Today</h1>
        <Button onClick={refresh} disabled={busy} variant="outline" size="sm">
          {busy ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      <div className="space-y-8">
        {LANES.map((lane) => {
          const laneItems = items.filter((i) => i.lane === lane.key);
          return (
            <section key={lane.key}>
              <h2 className="text-sm font-medium text-zinc-500 mb-2">
                {lane.label} <span className="ml-2">({laneItems.length})</span>
              </h2>
              <div className="space-y-2">
                {laneItems.map((it) => (
                  <Link key={`${it.source}:${it.id}`} href={hrefFor(it)}>
                    <Card className={`p-3 border-l-4 ${lane.tone} hover:bg-zinc-50 transition`}>
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{it.title}</div>
                        <div className="text-xs text-zinc-500">{it.actor}</div>
                      </div>
                      {it.detail && <div className="text-sm text-zinc-600 mt-1 line-clamp-2">{it.detail}</div>}
                      <div className="flex items-center gap-2 mt-2 text-xs text-zinc-400">
                        <span>{it.source.replace("_", " ")}</span>
                        {(it.meta as { aged?: boolean }).aged && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">stale</span>
                        )}
                      </div>
                    </Card>
                  </Link>
                ))}
                {laneItems.length === 0 && (
                  <div className="text-sm text-zinc-400 italic">— nothing here —</div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
```

### Step 2.6 — Sidebar entry

- [ ] Open `dashboard/components/layout/sidebar.tsx`. Find the `/inbox` nav item. Insert a new entry above it:

```tsx
{ href: "/today", label: "Today", icon: Sun },
```

(import `Sun` from `lucide-react` at the top of the file.)

### Step 2.7 — Update `dashboard/CLAUDE.md`

- [ ] In `dashboard/CLAUDE.md`, locate this sentence:

> "Workspace items (plans/projects/tasks/scopes) and inbox file blobs are still on disk in `COWORK_PATH`."

- [ ] Replace with:

> "Workspace items live in `public.workspace_items` (Supabase). Inbox captures live in `public.work_log`. The disk path (`COWORK_PATH`) stores agent personalities and free files only. The primary daily surface is `/today`."

### Step 2.8 — Verify

- [ ] Seed dummy rows so all three lanes are populated. (Use any two real `agents.id` values — `sophia` / `axel` are placeholders; query `select id from public.agents limit 2;` first if unsure.)

```sql
-- Run via MCP execute_sql
-- needs_you + in_flight + recently_shipped (one each)
insert into agent_tasks (id, from_agent, to_agent, title, description, status, priority, created_at, updated_at, completed_at, result)
values
  (gen_random_uuid()::text, 'sophia', 'axel', 'Test pending task', 'verifying needs_you', 'pending_approval', 2, now(), now(), null, null),
  (gen_random_uuid()::text, 'axel', 'sophia', 'Test in-flight task', 'verifying in_flight', 'in_progress', 3, now(), now(), null, null),
  (gen_random_uuid()::text, 'axel', 'sophia', 'Test recently-shipped task', 'verifying recently_shipped', 'completed', 3, now() - interval '1 day', now() - interval '1 day', now() - interval '1 hour', 'ok');
insert into proposals (kind, target_agent_id, payload, status, rationale, source_refs, proposed_at)
values ('triage_capture', null, '{"capture_id":"00000000-0000-0000-0000-000000000000","disposition":{"action":"archive","reason":"test"}}'::jsonb, 'proposed', 'test', '[]'::jsonb, now());
```

- [ ] `cd dashboard && npm run dev`
- [ ] Visit `http://localhost:3000/today`. Confirm three lanes render and the seeded items appear.
- [ ] `npm run build` and `npm run lint` from `dashboard/`. Both clean.
- [ ] Clean up seeds: `delete from agent_tasks where title like 'Test %'; delete from proposals where rationale='test';`
- [ ] **Commit:** `feat(today): add /today work-loop view across tasks/proposals/workspace`

---

## Phase 3 — Loop closure on task completion

**Goal:** When a task transitions to `completed` or `failed`, automatically (a) post a `work_log` retro entry, (b) append a one-line update to the linked workspace item if `project_slug` is set. **Drop `artifact_links` from this phase's goal** — parsing free-text result for workspace references is out of scope; can be added later when results become structured.

**Files:**
- Create: `dashboard/supabase/migrations/20260503110000_work_log_completion_unique.sql`
- Create: `dashboard/lib/task-completion.ts`
- Modify: `dashboard/lib/task-inbox.ts` (call helper from `updateTask`)

### Step 3.1 — Migration: idempotency guard

- [ ] DB-level uniqueness for completion entries — prevents the race in concurrent updates:

```sql
-- 20260503110000_work_log_completion_unique.sql
-- Idempotency guard: at most one completion log per task_id.
-- Uses a partial unique expression index on the artifacts JSONB.
create unique index if not exists work_log_task_completion_uniq
  on public.work_log ((artifacts->0->>'task_id'))
  where (artifacts->0->>'kind') = 'task_completion';
```

- [ ] Apply via `supabase db push`.
- [ ] Verify: `select indexname from pg_indexes where tablename='work_log' and indexname='work_log_task_completion_uniq';`

### Step 3.2 — `dashboard/lib/task-completion.ts`

```typescript
import { supabase } from "./supabase";
import type { AgentTask } from "@/types";

/**
 * Called when an agent_task transitions to completed/failed.
 * Idempotent via DB unique index (migration 20260503110000).
 * Catches and logs all errors — never throws to caller.
 */
export async function recordTaskCompletion(task: AgentTask): Promise<void> {
  if (task.status !== "completed" && task.status !== "failed") return;

  const verb = task.status === "completed" ? "Completed" : "Failed";
  const summary = `${verb}: ${task.title} (${task.toAgent})`;

  // Insert work_log row — DB unique index drops duplicates.
  const { error: logErr } = await supabase.from("work_log").insert({
    session_id: null,
    project: task.projectSlug ?? "factory",
    kind: "retro",
    summary,
    artifacts: [
      {
        kind: "task_completion",
        task_id: task.id,
        from_agent: task.fromAgent,
        to_agent: task.toAgent,
        status: task.status,
        result: task.result ?? null,
        project_slug: task.projectSlug ?? null,
      },
    ],
  });
  // Postgres unique-violation code is "23505" — that's the idempotency win, not a real error.
  if (logErr && logErr.code !== "23505") {
    console.error("recordTaskCompletion: work_log insert failed", logErr);
  }

  // Append a line to the linked workspace item (best effort).
  if (task.projectSlug) {
    try {
      const { data: ws, error: wsErr } = await supabase
        .from("workspace_items")
        .select("id, content")
        .eq("slug", task.projectSlug)
        .maybeSingle();
      if (wsErr) {
        console.error("recordTaskCompletion: workspace lookup failed", wsErr);
      } else if (ws) {
        const stamp = new Date().toISOString().slice(0, 10);
        const line = `\n- ${stamp} — ${verb.toLowerCase()}: ${task.title} (${task.toAgent}) [task:${task.id}]`;
        // Skip if we've already appended this exact line (defends against race).
        if (!(ws.content ?? "").includes(`[task:${task.id}]`)) {
          const { error: updErr } = await supabase
            .from("workspace_items")
            .update({
              content: (ws.content ?? "") + line,
              updated_at: new Date().toISOString(),
            })
            .eq("id", ws.id);
          if (updErr) console.error("recordTaskCompletion: workspace update failed", updErr);
        }
      }
    } catch (e) {
      console.error("recordTaskCompletion: workspace append failed", e);
    }
  }
}
```

### Step 3.3 — Wire into `updateTask`

- [ ] In `dashboard/lib/task-inbox.ts`, modify `updateTask` to call `recordTaskCompletion` after a successful update when status is terminal. Add the import at the top, then change the tail of `updateTask`:

```typescript
import { recordTaskCompletion } from "./task-completion";

// ... existing function body ...

  const { data, error } = await supabase
    .from("agent_tasks")
    .update(dbUpdates)
    .eq("id", taskId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const updated = data ? dbRowToTask(data) : null;
  if (updated && (updated.status === "completed" || updated.status === "failed")) {
    try {
      await recordTaskCompletion(updated);
    } catch (e) {
      console.error("recordTaskCompletion threw (suppressed):", e);
    }
  }
  return updated;
```

### Step 3.4 — Verify (through the API, not raw SQL)

- [ ] Create a test task and approve it via the existing approve API:

```bash
cd /Users/edmundmitchell/factory/dashboard
# 1. Create the test task via SQL (creation path is internal-only)
psql "$SUPABASE_DB_URL" -c "insert into agent_tasks (id, from_agent, to_agent, title, description, status, priority, project_slug, created_at, updated_at) values ('test-loop-closure', 'sophia', 'axel', 'TEST loop closure', 'verify phase 3', 'approved', 3, null, now(), now());"

# 2. Find the existing endpoint that updates status — locate it:
grep -rn "from(\"agent_tasks\")\\.update" app/api/ lib/

# 3. Hit that endpoint with status='completed' for taskId='test-loop-closure', or call updateTask via a one-off node script that imports it.
```

- [ ] **Preferred verification path** — call `updateTask` through `tsx` so the hook fires (TS source, not built JS):

```bash
cd /Users/edmundmitchell/factory/dashboard
npx tsx --env-file=.env.local -e "
import { updateTask } from './lib/task-inbox';
await updateTask('axel', 'test-loop-closure', { status: 'completed', result: 'phase 3 verification ok' });
"
```

- [ ] Confirm a `work_log` row appeared:

```sql
-- via MCP execute_sql
select summary, artifacts->0->>'task_id' as task_id
from public.work_log
where artifacts @> '[{"kind":"task_completion","task_id":"test-loop-closure"}]'::jsonb;
```

- [ ] Run the same `updateTask` call a second time. Confirm `select count(*) from work_log where artifacts @> '[{\"task_id\":\"test-loop-closure\"}]'::jsonb;` returns exactly **1** (idempotency).
- [ ] Cleanup: `delete from agent_tasks where id='test-loop-closure'; delete from work_log where artifacts @> '[{"task_id":"test-loop-closure"}]'::jsonb;`
- [ ] `npm run build` and `npm run lint`. Clean.
- [ ] **Commit:** `feat(tasks): record completion to work_log + workspace_items, idempotent`

---

## Phase 4 — Triage agent + aging (merged)

**Goal:** Every new `work_log` capture (`kind in ('note','research')`) and every capture older than 5 days with no triage proposal gets a `triage_capture` proposal in `public.proposals`. Edmund approves in `/inbox/promotions`. One cron handles both new and aged.

**Files:**
- Create: `dashboard/supabase/migrations/20260503120000_proposals_triage_unique.sql`
- Create: `dashboard/lib/triage.ts`
- Create: `dashboard/app/api/cron/triage-captures/route.ts`
- Modify: `dashboard/app/api/promotions/proposal/route.ts` (add `triage_capture` arm)
- Modify: `dashboard/app/inbox/promotions/proposal-card.tsx` (render `triage_capture`)
- Modify: `dashboard/vercel.json` (add cron entry)

### Step 4.1 — Migration: idempotency for triage proposals

- [ ] Unique partial index on `(payload->>'capture_id')` for triage_capture proposals in proposed status — prevents duplicate proposals from concurrent cron runs:

```sql
-- 20260503120000_proposals_triage_unique.sql
create unique index if not exists proposals_triage_capture_uniq
  on public.proposals ((payload->>'capture_id'))
  where kind = 'triage_capture' and status = 'proposed';
```

- [ ] Apply via `supabase db push`. Verify with `select indexname from pg_indexes where indexname='proposals_triage_capture_uniq';`.

### Step 4.2 — `dashboard/lib/triage.ts`

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabase";

const TRIAGE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface TriageDisposition {
  action: "archive" | "link_to_project" | "create_task" | "create_project";
  reason: string;
  workspace_item_slug?: string;          // for link_to_project
  proposed_title?: string;               // for create_task / create_project
  proposed_department?: "factory" | "marketing" | "design" | "strategy" | "general";
  proposed_owner?: string;
  proposed_to_agent?: string;            // for create_task
}

export async function triageCapture(captureId: string): Promise<TriageDisposition> {
  const { data: capture, error: capErr } = await supabase
    .from("work_log")
    .select("id, summary, kind, project, artifacts, created_at")
    .eq("id", captureId)
    .maybeSingle();
  if (capErr) throw new Error(`capture lookup: ${capErr.message}`);
  if (!capture) throw new Error(`capture ${captureId} not found`);

  const { data: activeItems } = await supabase
    .from("workspace_items")
    .select("slug, title, type, department, status")
    .in("status", ["active", "in_progress"])
    .order("updated_at", { ascending: false })
    .limit(20);

  const system = `You are a triage agent for Edmund's inbox. Given one capture (a quick note, voice memo, or research blob), propose ONE disposition. Be conservative: prefer 'archive' for vague musings, 'link_to_project' when there's an obvious match in the active workspace items, 'create_task' for concrete next-actions under 1 day, 'create_project' only for multi-step initiatives. Output STRICT JSON matching the TriageDisposition shape — no prose, no markdown fences. Required field: action, reason. Optional fields per action: workspace_item_slug (link_to_project), proposed_title + proposed_department + proposed_owner (create_task/create_project), proposed_to_agent (create_task).`;

  const userMsg = JSON.stringify(
    {
      capture: { summary: capture.summary, kind: capture.kind, project: capture.project, artifacts: capture.artifacts },
      active_workspace_items: activeItems ?? [],
    },
    null,
    2
  );

  const resp = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 512,
    system,
    messages: [{ role: "user", content: userMsg }],
  });
  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim()
    // Strip ```json fences if the model added them anyway.
    .replace(/^```(?:json)?\s*|\s*```$/g, "");
  return JSON.parse(text) as TriageDisposition;
}

/** Insert a triage proposal. Returns proposal id, or null if a duplicate was prevented by the unique index. */
export async function fileTriageProposal(
  captureId: string,
  disposition: TriageDisposition,
  source: "fresh" | "aged"
): Promise<string | null> {
  const { data, error } = await supabase
    .from("proposals")
    .insert({
      kind: "triage_capture",
      target_agent_id: null,
      target_skill_name: null,
      payload: { capture_id: captureId, disposition, source },
      status: "proposed",
      rationale: disposition.reason,
      source_refs: [{ source: "work_log", id: captureId }],
      proposed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return null; // unique violation = already filed; expected
    throw new Error(error.message);
  }
  return data.id as string;
}
```

### Step 4.3 — Cron: `dashboard/app/api/cron/triage-captures/route.ts`

```typescript
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { triageCapture, fileTriageProposal } from "@/lib/triage";

const FRESH_BATCH = 5;
const AGED_BATCH = 5;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fresh: captures in last 24h.
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: fresh } = await supabase
    .from("work_log")
    .select("id")
    .in("kind", ["note", "research"])
    .gte("created_at", since24h)
    .order("created_at", { ascending: true })
    .limit(FRESH_BATCH * 4);

  // Aged: captures older than 5 days with no triage proposal yet.
  const since5d = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  const { data: aged } = await supabase
    .from("work_log")
    .select("id")
    .in("kind", ["note", "research"])
    .lt("created_at", since5d)
    .order("created_at", { ascending: true })
    .limit(AGED_BATCH * 4);

  const allIds = Array.from(new Set([...(fresh ?? []), ...(aged ?? [])].map((r) => r.id as string)));
  if (allIds.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  // Filter out captures that already have ANY triage proposal (proposed/live/rejected).
  const { data: existing } = await supabase
    .from("proposals")
    .select("payload")
    .eq("kind", "triage_capture")
    .in("status", ["proposed", "live", "rejected"]);
  const seen = new Set<string>(
    (existing ?? [])
      .map((p) => (p.payload as { capture_id?: string })?.capture_id)
      .filter((x): x is string => Boolean(x))
  );

  const freshTodo = (fresh ?? []).map((r) => r.id as string).filter((id) => !seen.has(id)).slice(0, FRESH_BATCH);
  const agedTodo = (aged ?? []).map((r) => r.id as string).filter((id) => !seen.has(id)).slice(0, AGED_BATCH);

  const results: Array<{ capture_id: string; source: "fresh" | "aged"; ok: boolean; proposal_id?: string | null; error?: string }> = [];

  for (const id of freshTodo) {
    try {
      const d = await triageCapture(id);
      const pid = await fileTriageProposal(id, d, "fresh");
      results.push({ capture_id: id, source: "fresh", ok: true, proposal_id: pid });
    } catch (e) {
      results.push({ capture_id: id, source: "fresh", ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const id of agedTodo) {
    // Aged: bypass the LLM and force action='archive' to keep cost low and behavior boring.
    const d = { action: "archive" as const, reason: "Auto-archive — capture stale 5d+ with no human action" };
    try {
      const pid = await fileTriageProposal(id, d, "aged");
      results.push({ capture_id: id, source: "aged", ok: true, proposal_id: pid });
    } catch (e) {
      results.push({ capture_id: id, source: "aged", ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, processed: freshTodo.length + agedTodo.length, results });
}
```

### Step 4.4 — Approval dispatch arm

- [ ] Open `dashboard/app/api/promotions/proposal/route.ts`. At the top of the file, add `import { randomUUID } from "crypto";`. Inside the existing if/else if chain (after the `memory-entry` arm and before the `skill` arm or the final `else { unknown kind }`), insert the `triage_capture` arm. Note: `now` is already declared as `const now = new Date().toISOString();` at the top of the approve branch — reuse it.

```typescript
} else if (proposal.kind === "triage_capture") {
  const payload = proposal.payload as {
    capture_id: string;
    disposition: import("@/lib/triage").TriageDisposition;
  };
  const d = payload.disposition;
  if (d.action === "archive") {
    materializedTargetId = null;
  } else if (d.action === "link_to_project") {
    if (!d.workspace_item_slug) {
      return NextResponse.json(
        { error: "link_to_project missing workspace_item_slug" },
        { status: 400 }
      );
    }
    const { data: ws } = await supabase
      .from("workspace_items")
      .select("id")
      .eq("slug", d.workspace_item_slug)
      .maybeSingle();
    if (!ws) {
      return NextResponse.json(
        { error: `workspace item ${d.workspace_item_slug} not found` },
        { status: 400 }
      );
    }
    // Append a content line referencing the capture instead of creating an
    // artifact_links row (artifact_links wants a real disk path, not a synthetic ref).
    const { data: full } = await supabase
      .from("workspace_items")
      .select("content")
      .eq("id", ws.id)
      .maybeSingle();
    const stamp = new Date().toISOString().slice(0, 10);
    const note = `\n- ${stamp} — linked capture [capture:${payload.capture_id}]: ${d.reason}`;
    if (!(full?.content ?? "").includes(`[capture:${payload.capture_id}]`)) {
      await supabase
        .from("workspace_items")
        .update({ content: (full?.content ?? "") + note, updated_at: now })
        .eq("id", ws.id);
    }
    materializedTargetId = ws.id as string;
  } else if (d.action === "create_task") {
    // Route through createTask() so Phase 1's agent-id assertions run
    // (validates to_agent exists; allows 'triage' as pseudo-sender).
    // agent_tasks.id is text — materialized_target_id (uuid) stays null.
    const { createTask } = await import("@/lib/task-inbox");
    try {
      await createTask({
        fromAgent: "triage",
        fromName: "Triage",
        fromEmoji: "🧭",
        toAgent: d.proposed_to_agent ?? "cordis",
        title: d.proposed_title ?? "Triaged capture",
        description: `From capture ${payload.capture_id}\n\n${d.reason}`,
        priority: 3,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 }
      );
    }
    materializedTargetId = null;
  } else if (d.action === "create_project") {
    const baseSlug = (d.proposed_title ?? "triaged-project")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: inserted, error: pErr } = await supabase
      .from("workspace_items")
      .insert({
        slug,
        title: d.proposed_title ?? "Triaged project",
        type: "project",
        department: d.proposed_department ?? "general",
        status: "active",
        owner: d.proposed_owner ?? null,
        content: `Created from capture ${payload.capture_id} [capture:${payload.capture_id}]\n\nReason: ${d.reason}`,
        tags: ["triaged"],
      })
      .select("id")
      .single();
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    materializedTargetId = inserted.id as string;
  } else {
    return NextResponse.json(
      { error: `unknown triage action: ${(d as { action?: string }).action ?? "(missing)"}` },
      { status: 400 }
    );
  }
}
```

- [ ] Idempotency check: at the top of the approve branch (right after fetching the proposal and before the dispatch), early-return if it's already live to handle double-clicks:

```typescript
// Defend against double-approval (UI race or retry).
if (proposal.status === "live") {
  return NextResponse.json({ ok: true, already_live: true });
}
```

### Step 4.5 — Card UI for triage_capture

- [ ] In `dashboard/app/inbox/promotions/proposal-card.tsx`, add a render branch for `kind === "triage_capture"`. Show:
  - The capture summary (look up via the `capture_id` in payload, or just show payload.capture_id and let user click through)
  - The proposed action (Archive / Link / Create task / Create project)
  - The reason
  - Approve / Reject buttons that POST to `/api/promotions/proposal`

Concrete snippet to add near the existing card branches (adjust to existing JSX style):

```tsx
{proposal.kind === "triage_capture" && (
  <div className="space-y-2">
    <div className="text-xs uppercase tracking-wide text-zinc-500">Triage proposal</div>
    <div className="font-medium">{(proposal.payload as any)?.disposition?.action}</div>
    <div className="text-sm text-zinc-700">{(proposal.payload as any)?.disposition?.reason}</div>
    <div className="text-xs text-zinc-500">
      Capture: <a href={`/inbox#${(proposal.payload as any)?.capture_id}`} className="underline">{(proposal.payload as any)?.capture_id}</a>
    </div>
    <div className="flex gap-2 pt-2">
      <button onClick={() => approve(proposal.id)} className="px-3 py-1 bg-emerald-600 text-white rounded">Approve</button>
      <button onClick={() => reject(proposal.id)} className="px-3 py-1 bg-zinc-200 rounded">Reject</button>
    </div>
  </div>
)}
```

### Step 4.6 — Vercel cron

- [ ] In `dashboard/vercel.json`, add to the `crons` array:

```json
{ "path": "/api/cron/triage-captures", "schedule": "*/15 * * * *" }
```

### Step 4.7 — Verify

- [ ] Insert a test capture: `insert into work_log (project, kind, summary, artifacts) values ('factory','note','phase 4 triage test','[]'::jsonb);` — note the returned id.
- [ ] Hit cron: `CRON=$(grep ^CRON_SECRET dashboard/.env.local | cut -d= -f2-); curl -s -H "Authorization: Bearer $CRON" http://localhost:3000/api/cron/triage-captures | jq`
- [ ] Confirm a `proposals` row of `kind='triage_capture'` exists for that capture.
- [ ] Hit cron a second time. Confirm `select count(*) from proposals where payload->>'capture_id' = '<id>' and kind='triage_capture';` returns **1** (idempotency).
- [ ] Approve via `/inbox/promotions` UI. Confirm materialization (task/project created OR archive proposal flips to live).
- [ ] Cleanup (Postgres `delete` does not support `limit`; use a CTE if you need to bound it):

```sql
delete from work_log where summary = 'phase 4 triage test';
delete from proposals where rationale like '%phase 4%' or payload->>'capture_id' in (
  select id::text from work_log where summary = 'phase 4 triage test'
);
```
- [ ] `npm run build` and `npm run lint`. Clean.
- [ ] **Commit:** `feat(triage): auto-propose dispositions for fresh + aged captures`

---

## Phase 5 — Self-improvement proposals

**Goal:** Two new proposal kinds: `new_skill` (an agent proposes a new skill body) and `pattern_observation` (an agent flags a recurring pattern worth acknowledging). Both flow through `/inbox/promotions`. **`update_sop` is deferred** — it crosses into Notion territory and deserves its own plan.

**Files:**
- Modify: `dashboard/lib/tools.ts` — add `propose_skill` and `propose_pattern` tools
- Modify: `dashboard/app/api/promotions/proposal/route.ts` — add `new_skill` and `pattern_observation` arms
- Modify: `dashboard/app/inbox/promotions/proposal-card.tsx` — render the two new kinds

### Step 5.1 — Tool definitions

- [ ] In `dashboard/lib/tools.ts`, append these two tool entries to the tool array (the array currently lives near the top of the file, around the `name: "create_workspace_item"` entry — match its formatting):

```typescript
{
  name: "propose_skill",
  description:
    "Propose a NEW skill for the registry. Use when you observe a repeated workflow that should be codified into a reusable skill. The proposal lands in Edmund's promotion queue.",
  input_schema: {
    type: "object",
    properties: {
      skill_name: { type: "string", description: "kebab-case name, e.g. weekly-review-prep" },
      body: { type: "string", description: "Full SKILL.md body including YAML frontmatter" },
      rationale: { type: "string", description: "Why this skill is needed; cite evidence" },
      source_refs: {
        type: "array",
        items: {
          type: "object",
          properties: { source: { type: "string" }, id: { type: "string" } },
          required: ["source", "id"],
        },
        description: "Pointers to evidence rows (work_log id, agent_tasks id, etc.)",
      },
    },
    required: ["skill_name", "body", "rationale"],
  },
},
{
  name: "propose_pattern",
  description:
    "Flag a recurring pattern you've observed across captures, tasks, or sessions. Use when you don't yet have a concrete next-step but want Edmund to see the trend. The proposal lands in Edmund's promotion queue and is acknowledged on approve (no automated action).",
  input_schema: {
    type: "object",
    properties: {
      pattern_summary: { type: "string", description: "One-sentence description of the pattern" },
      occurrences: {
        type: "array",
        items: {
          type: "object",
          properties: { source: { type: "string" }, id: { type: "string" }, note: { type: "string" } },
          required: ["source", "id"],
        },
        description: "Specific evidence rows demonstrating the pattern",
      },
      suggested_action: { type: "string", description: "What you'd recommend if anything" },
    },
    required: ["pattern_summary", "occurrences"],
  },
},
```

- [ ] In the `executeTool` switch in the same file, add two new cases. Place them next to the existing `create_workspace_item` case:

```typescript
case "propose_skill": {
  const input = toolUse.input as {
    skill_name: string;
    body: string;
    rationale: string;
    source_refs?: Array<{ source: string; id: string }>;
  };
  const { data, error } = await supabase
    .from("proposals")
    .insert({
      kind: "new_skill",
      target_agent_id: agentId,
      target_skill_name: input.skill_name,
      payload: { skill_name: input.skill_name, body: input.body },
      status: "proposed",
      rationale: input.rationale,
      source_refs: input.source_refs ?? [],
      proposed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, proposal_id: data.id, message: `Filed new_skill proposal for "${input.skill_name}".` };
}

case "propose_pattern": {
  const input = toolUse.input as {
    pattern_summary: string;
    occurrences: Array<{ source: string; id: string; note?: string }>;
    suggested_action?: string;
  };
  const { data, error } = await supabase
    .from("proposals")
    .insert({
      kind: "pattern_observation",
      target_agent_id: agentId,
      target_skill_name: null,
      payload: {
        pattern_summary: input.pattern_summary,
        occurrences: input.occurrences,
        suggested_action: input.suggested_action ?? null,
      },
      status: "proposed",
      rationale: input.pattern_summary,
      source_refs: input.occurrences,
      proposed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, proposal_id: data.id, message: `Filed pattern_observation proposal.` };
}
```

### Step 5.2 — Approval dispatch arms

- [ ] In `dashboard/app/api/promotions/proposal/route.ts`, add two more arms. `new_skill` goes through the existing `skill_versions` row + disk-promote path; `pattern_observation` is a no-op materialization.

```typescript
} else if (proposal.kind === "new_skill") {
  const payload = proposal.payload as { skill_name: string; body: string };
  if (!payload?.skill_name || !payload?.body) {
    return NextResponse.json(
      { error: "new_skill payload missing skill_name/body" },
      { status: 400 }
    );
  }
  // Insert at version 1 (or next) into skill_versions; mark approved immediately.
  const { data: maxRow } = await supabase
    .from("skill_versions")
    .select("version")
    .eq("skill_name", payload.skill_name)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (maxRow?.version ?? 0) + 1;
  const { data: inserted, error: insErr } = await supabase
    .from("skill_versions")
    .insert({
      skill_name: payload.skill_name,
      version: nextVersion,
      body: payload.body,
      changelog: "Created via new_skill proposal",
      created_by: proposal.target_agent_id ?? "agent",
      metadata: {},
      status: "approved",
      approved_at: now,
      approved_by: "edmund",
    })
    .select("id")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  // Disk promotion happens via the existing promote-skill.mjs script — fire and forget.
  // The approve handler in /api/promotions handles disk for skill_versions; for parity
  // we leave disk-write as a follow-up so this route stays focused on DB materialization.
  materializedTargetId = inserted.id as string;
} else if (proposal.kind === "pattern_observation") {
  // Acknowledgment-only: no materialization beyond flipping status to 'live'.
  materializedTargetId = null;
}
```

- [ ] **Note for executor:** the existing `/api/promotions` route (skill_versions path) handles disk-promote via `promote-skill.mjs`. For `new_skill` proposals approved through `/api/promotions/proposal`, we deliberately skip disk-write in this plan — file as a `[loose-end]` to wire the same `execFileAsync(PROMOTE_SCRIPT, [skillVersionsId])` call here later. The DB row is the source of truth either way.

### Step 5.3 — Card renderers

- [ ] In `proposal-card.tsx`, add two more branches mirroring the `triage_capture` pattern:

```tsx
{proposal.kind === "new_skill" && (
  <div className="space-y-2">
    <div className="text-xs uppercase tracking-wide text-zinc-500">New skill proposal</div>
    <div className="font-medium">{(proposal.payload as any)?.skill_name}</div>
    <div className="text-sm text-zinc-700">{proposal.rationale}</div>
    <details className="text-xs">
      <summary className="cursor-pointer">Show body</summary>
      <pre className="mt-1 p-2 bg-zinc-50 overflow-auto">{(proposal.payload as any)?.body}</pre>
    </details>
    <div className="flex gap-2 pt-2">
      <button onClick={() => approve(proposal.id)} className="px-3 py-1 bg-emerald-600 text-white rounded">Approve</button>
      <button onClick={() => reject(proposal.id)} className="px-3 py-1 bg-zinc-200 rounded">Reject</button>
    </div>
  </div>
)}
{proposal.kind === "pattern_observation" && (
  <div className="space-y-2">
    <div className="text-xs uppercase tracking-wide text-zinc-500">Pattern observation</div>
    <div className="font-medium">{(proposal.payload as any)?.pattern_summary}</div>
    {(proposal.payload as any)?.suggested_action && (
      <div className="text-sm text-zinc-700">Suggested: {(proposal.payload as any)?.suggested_action}</div>
    )}
    <div className="text-xs text-zinc-500">
      {((proposal.payload as any)?.occurrences ?? []).length} occurrences
    </div>
    <div className="flex gap-2 pt-2">
      <button onClick={() => approve(proposal.id)} className="px-3 py-1 bg-emerald-600 text-white rounded">Acknowledge</button>
      <button onClick={() => reject(proposal.id)} className="px-3 py-1 bg-zinc-200 rounded">Dismiss</button>
    </div>
  </div>
)}
```

### Step 5.4 — Verify

- [ ] In a chat session with any agent, ask it to call `propose_skill` with a stub:

```
Please file a propose_skill with skill_name="phase-5-test-skill", body="---\nname: phase-5-test-skill\ndescription: test\n---\n\nbody", rationale="phase 5 verification", source_refs=[].
```

- [ ] Confirm a `proposals` row appears at `/inbox/promotions`.
- [ ] Approve via UI; confirm a `skill_versions` row of that name exists with `status='approved'`.
- [ ] Cleanup: `delete from skill_versions where skill_name='phase-5-test-skill'; delete from proposals where target_skill_name='phase-5-test-skill';`
- [ ] `npm run build` and `npm run lint`. Clean.
- [ ] **Commit:** `feat(proposals): new_skill + pattern_observation kinds wired through promotions`

---

## Phase 6 — Workspace-item gating via proposals (opt-in)

**Goal:** When an agent calls `create_workspace_item`, the row goes to `proposals` (kind=`workspace_item`) only if the agent's `toolTags` includes `gated_workspace`. Default off — opt-in per agent. Returned shape mirrors the un-gated path so callers don't break.

**Files:**
- Modify: `dashboard/lib/tools.ts` — wrap the existing `create_workspace_item` execute branch
- Modify: `dashboard/app/api/promotions/proposal/route.ts` — add `workspace_item` arm
- Modify: `dashboard/app/inbox/promotions/proposal-card.tsx` — render `workspace_item`

### Step 6.1 — Wrap the tool

- [ ] In `dashboard/lib/tools.ts`, find `case "create_workspace_item":` (around line 882). At the very top of the case body, after fetching the calling agent, branch on `toolTags`:

```typescript
case "create_workspace_item": {
  const input = toolUse.input as {
    title: string;
    type: string;
    department: string;
    content?: string;
    owner?: string;
    tags?: string[];
    status?: string;
    rationale?: string;
  };
  const agent = await getAgent(agentId);
  if ((agent?.toolTags ?? []).includes("gated_workspace")) {
    // Generate the slug now so the agent can reference it in conversation
    // even before approval — the materialization arm uses the same slug.
    const baseSlug = input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
    const proposedSlug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: prop, error: propErr } = await supabase
      .from("proposals")
      .insert({
        kind: "workspace_item",
        target_agent_id: agentId,
        payload: { ...input, proposed_slug: proposedSlug, proposed_by: agentId },
        status: "proposed",
        rationale: input.rationale ?? `${agent?.name ?? agentId} proposes a new ${input.type}`,
        source_refs: [],
        proposed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (propErr) return { ok: false, error: propErr.message };
    // Mirror the un-gated tool's return shape: id null (no row yet), slug set,
    // status="proposed". Existing callers reading `slug` keep working.
    return {
      ok: true,
      gated: true,
      proposal_id: prop.id,
      id: null,
      slug: proposedSlug,
      status: "proposed",
      message: `Workspace ${input.type} filed as proposal — awaiting Edmund's approval.`,
    };
  }
  // ... existing direct-insert path stays as-is below ...
}
```

### Step 6.2 — Approval arm

- [ ] In `/api/promotions/proposal/route.ts`, add the `workspace_item` arm. Use the slug already on the proposal payload so it matches what the agent has been talking about.

```typescript
} else if (proposal.kind === "workspace_item") {
  const payload = proposal.payload as {
    proposed_slug: string;
    title: string;
    type: string;
    department: string;
    content?: string;
    owner?: string;
    tags?: string[];
    status?: string;
  };
  if (!payload?.proposed_slug || !payload?.title || !payload?.type || !payload?.department) {
    return NextResponse.json(
      { error: "workspace_item payload missing required fields" },
      { status: 400 }
    );
  }
  const { data: inserted, error: wErr } = await supabase
    .from("workspace_items")
    .insert({
      slug: payload.proposed_slug,
      title: payload.title,
      type: payload.type,
      department: payload.department,
      status: payload.status ?? "active",
      owner: payload.owner ?? null,
      content: payload.content ?? "",
      tags: payload.tags ?? [],
    })
    .select("id")
    .single();
  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 });
  materializedTargetId = inserted.id as string;
}
```

### Step 6.3 — Card UI

- [ ] Add a `workspace_item` branch in `proposal-card.tsx` showing title / type / department / proposed_slug / rationale / Approve+Reject buttons. Match the existing card layout.

### Step 6.4 — Verify

- [ ] Pick a test agent and add `gated_workspace` to its tool_tags:

```sql
update public.agents set tool_tags = array_append(coalesce(tool_tags,'{}'), 'gated_workspace') where id='axel' and not 'gated_workspace' = any(coalesce(tool_tags,'{}'));
```

- [ ] In a chat session with that agent, have it call `create_workspace_item`. Confirm a `proposals` row appears (no `workspace_items` row yet).
- [ ] Approve via UI. Confirm `workspace_items` row exists at the proposed slug.
- [ ] Cleanup: revert agent (`update public.agents set tool_tags = array_remove(tool_tags,'gated_workspace') where id='axel';`), delete test rows.
- [ ] `npm run build` and `npm run lint`. Clean.
- [ ] **Commit:** `feat(proposals): gate workspace_item creation per-agent via tool_tag`

---

## Self-review checklist (run before declaring done)

- [ ] All 6 phases ship; each has its own verification step that exercises the actual code path (not raw SQL bypass).
- [ ] No placeholders ("TODO", "TBD", "similar to Task N", "existing union members").
- [ ] No phase-numbering mismatches between the table at top, the body headings, and the paste prompt below.
- [ ] All migrations have idempotent DDL (`create or replace view`, `create unique index if not exists`).
- [ ] Two unique partial indexes exist by end of Phase 4: `work_log_task_completion_uniq` (Phase 3) and `proposals_triage_capture_uniq` (Phase 4). No new index in Phase 5/6 — the regular `(kind, status)` index is enough.
- [ ] `materialized_target_id` set to a uuid only when the materialized row's id is uuid; left null when materializing into `agent_tasks` (text id).
- [ ] `dashboard/CLAUDE.md` corrected (Phase 2.7).
- [ ] Cron secret read via `process.env.CRON_SECRET`, not hardcoded.
- [ ] `npm run build` passed at the end of every phase.

## Loose ends to file (don't fix in this plan)

- After Phase 5 lands, wire `promote-skill.mjs` into the `/api/promotions/proposal` `new_skill` arm so disk write happens automatically (same as the legacy `/api/promotions` skill_versions path). File as `[loose-end]` agent_tasks row.
- **`/api/tasks` create path still trusts `fromAgent` from request JSON.** Phase 1 added an existence check, but the full fix (binding `fromAgent` to authenticated server context) is a separate auth concern — file as `[loose-end]`. The pseudo-sender allowlist (`triage`, `system`) keeps existing flows working.
- **Direct `workspace_items` writes in Phases 3, 4, 6** bypass the `saveWorkspaceItem` helper. The helper does upsert-by-slug and triggers no side-effects we'd lose; direct insert is acceptable here, but if `saveWorkspaceItem` ever grows side-effects (e.g. cache invalidation), revisit these call sites.
- **Triage idempotency index covers only `status='proposed'`** — a rejected proposal will block re-triage of the same capture. Acceptable for now; if you ever want to re-triage rejected captures, drop the `where status='proposed'` clause from the index.
- **`work_log_task_completion_uniq` indexes `artifacts->0`** — works only because the helper inserts a single-element array. If a future code path appends additional artifacts, the index assumption breaks.
- `update_sop` proposal kind: out of scope. Needs its own plan once Notion sync direction is decided.
- `proposals.materialized_target_id` is uuid; future migration could change to text or add `materialized_task_id text` column to capture task materializations.
- The Today view's `recently_shipped` lane window is 7d; pageable history is a v2 concern. The lane name covers both completed-and-resolved and rejected proposals (rejected proposals show in the same lane with `meta.final_status='rejected'`); rename to `recently_resolved` if that becomes confusing.

---

## Ready-to-paste prompt (autonomous execution)

```
Execute the plan at ops/plans/2026-05-03-dashboard-work-loop.md.

Working rules:
- Use the superpowers:executing-plans skill (inline execution with checkpoints).
- Phase order is 1 → 2 → 3 → 4 → 5 → 6. After EACH phase: run the listed verification AND `npm run build` AND `npm run lint` from dashboard/. Commit with the message specified in that phase. Do not start the next phase until all three pass.
- If a verification fails, STOP and report what you found. Do not skip ahead.
- Do not modify files outside the paths listed in each phase's "Files" header without surfacing it first.
- Supabase project_id is obizmgugsqirmnjpirnh. Migrations apply via `supabase db push` from dashboard/ (uses SUPABASE_ACCESS_TOKEN from dashboard/.env.local). Do NOT use the Supabase MCP apply_migration unless the CLI fails.
- Do not edit anything under COWORK_PATH or under agent personalities/. This plan does not touch personas.
- When done with all 6 phases: (a) re-run npm run build + npm run lint, (b) cross-check the plan against the diff, (c) write a one-page retro to ops/research/2026-05-03-work-loop-retro.md noting anything that surprised you and any loose ends.

Then ping Edmund: paste the retro path + a 3-bullet summary of what shipped.
```
