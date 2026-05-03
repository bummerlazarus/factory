# Handoff: Dashboard Supabase Migration

**Date:** 2026-04-17  
**Status:** Schema partially created. Migration plan written but not yet executed. Needs deep code review before proceeding.

---

## What we're doing

Migrating the dashboard app (`/Users/edmundmitchell/factory/dashboard/`) from fully filesystem-based storage to Supabase. The app is clean Next.js 16 / React 19 / TypeScript — no Supabase integration exists yet. All data is currently read/written via `fs/promises`.

## What's already done

1. **4 new tables created** in Supabase project `obizmgugsqirmnjpirnh`:
   - `agent_memory` — per-agent, append-only (context / decisions / learnings)
   - `workspace_items` — plans, projects, tasks, scopes
   - `agent_tasks` — task inbox
   - `slack_messages` — inter-agent communication

2. **Migration plan written** at:
   `/Users/edmundmitchell/factory/dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md`
   ⚠️ This plan was written **before** discovering existing Supabase tables and needs revision.

3. **Dashboard moved** from `local agent dashboard/` → `dashboard/` within the factory monorepo.

## Existing Supabase tables to reuse (don't recreate)

| Dashboard lib file | Use this existing table | Notes |
|---|---|---|
| `lib/sessions.ts` | `agent_conversations` | Has persona_id, title, messages (jsonb), created_at, updated_at |
| `lib/changelog.ts` | `agent_activity_log` | Has type, detail, metadata (jsonb), 2,614 rows already |
| `lib/agent-memory.ts` | NEW `agent_memory` | `agent_core_memory` is global key/value — wrong shape |
| `lib/task-inbox.ts` | NEW `agent_tasks` | — |
| `lib/slack.ts` | NEW `slack_messages` | — |
| `lib/workspace.ts` | NEW `workspace_items` | Existing `projects` table is portfolio-only |

Also available and useful:
- `agent_cost_log` — already tracking tokens/cost per model call (486 rows)
- `factory_sessions` — Claude Code session tracking (91 rows)
- `factory_events` — session event log (166 rows)

## ⚠️ What the previous session missed

**The migration plan was written at a high level without deeply reading the dashboard source code.** Edmund flagged that agent tasks, agent memory, and likely other entities need proper per-agent scoping. Before executing any migration task, you must:

1. **Read every lib file fully** before writing the Supabase replacement — `lib/sessions.ts`, `lib/task-inbox.ts`, `lib/agent-memory.ts`, `lib/slack.ts`, `lib/workspace.ts`, `lib/changelog.ts`
2. **Check `types/index.ts`** — all TypeScript interfaces live here; the migration must map these exactly
3. **Check `app/api/`** — every API route that calls these lib functions; some routes may do additional logic that affects how data is shaped
4. **Verify the 4 new tables** have the right columns for per-agent scoping:
   - `agent_memory` has `agent_id` ✓
   - `agent_tasks` has `from_agent` + `to_agent` ✓ — but verify this matches `lib/task-inbox.ts` exactly
   - `workspace_items` — does the dashboard scope these per agent or per department? Check the code.
   - `slack_messages` has `agent` column ✓

## Key file paths

```
/Users/edmundmitchell/factory/dashboard/
  lib/
    sessions.ts         ← maps to agent_conversations
    task-inbox.ts       ← maps to agent_tasks
    agent-memory.ts     ← maps to agent_memory
    slack.ts            ← maps to slack_messages
    workspace.ts        ← maps to workspace_items
    changelog.ts        ← maps to agent_activity_log
    agents.ts           ← stays filesystem (reads from iCloud COWORK_PATH)
    supabase.ts         ← DOES NOT EXIST YET, needs to be created
  types/
    index.ts            ← all TypeScript interfaces
  app/api/
    agents/             ← filesystem, leave alone
    chat/               ← calls lib/sessions.ts + lib/agent-memory.ts
    sessions/           ← calls lib/sessions.ts
    tasks/              ← calls lib/task-inbox.ts
    tasks/approve/      ← calls lib/task-inbox.ts + lib/slack.ts
    workspace/          ← calls lib/workspace.ts
    changelog/          ← calls lib/changelog.ts
    slack/              ← calls lib/slack.ts
    memory/             ← calls lib/agent-memory.ts
```

## Supabase connection info

- **Project ID:** `obizmgugsqirmnjpirnh`
- **Service role key:** available via Supabase MCP (already connected) or Supabase dashboard → Project Settings → API
- **Supabase MCP:** connected as `mcp__fb0388c7-b88a-4c28-9378-80e4bc008acd__*`

## How to proceed

**Do not execute the migration plan as written.** Instead:

1. Read all lib files + types/index.ts in full
2. Read all API routes in `app/api/`
3. Cross-reference against the 4 new tables + existing tables to verify the column shapes are correct — fix any mismatches with a new migration before writing any app code
4. Then execute the migration lib-file by lib-file, starting with the simplest (`lib/changelog.ts` → `agent_activity_log` is a good first one)
5. Test each lib file in the running app before moving to the next

## Ready-to-paste prompt for new session

```
I need to migrate the dashboard app at `/Users/edmundmitchell/factory/dashboard/` from filesystem storage to Supabase. A partial migration plan exists at `/Users/edmundmitchell/factory/dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md` but it needs revision — it was written without deeply reading the source code.

Your first job: read ALL of the following files completely before writing a single line of code:
- `lib/sessions.ts`, `lib/task-inbox.ts`, `lib/agent-memory.ts`, `lib/slack.ts`, `lib/workspace.ts`, `lib/changelog.ts`
- `types/index.ts`
- All files under `app/api/`

Then check the existing Supabase schema (project ID: `obizmgugsqirmnjpirnh`, Supabase MCP is connected). 4 new tables were already created: `agent_memory`, `workspace_items`, `agent_tasks`, `slack_messages`. Existing tables to reuse: `agent_conversations` (for chat sessions), `agent_activity_log` (for changelog).

After reading everything, produce a revised mapping of each lib file → Supabase table, flag any schema mismatches that need a migration fix, then execute the migration one lib file at a time — read, write Supabase replacement, test in the running app, commit. Start with `lib/changelog.ts` as it's simplest.

Key constraint: agents stay filesystem-based (they load from iCloud COWORK_PATH). Everything else moves to Supabase.
```
