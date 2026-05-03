# Agent definitions — source of truth

**Date:** 2026-05-03
**Status:** Active convention. If you're a future Claude session reading this, follow it.

## TL;DR

- **Disk = source of truth** for agent definitions (identity, CLAUDE.md, soul).
- **Supabase `public.agents` = derived runtime cache.**
- **Sync direction: disk → DB.** Run `node ops/bin/sync-agents.mjs` after editing any agent file.
- **Never edit `public.agents` rows directly** unless you're patching a runtime emergency — and if you do, immediately mirror the change back to disk so the next sync doesn't overwrite it.

## Why this matters (history of the bug that produced this doc)

On 2026-05-03 a Claude Code session edited Cordis's `CLAUDE.md` on disk to add a `retrieve` tool to his allowlist, claimed the fix was live, and verified zero times. The dashboard kept loading the old prompt because `dashboard/lib/agents.ts` reads agents from the `public.agents` table — not from disk. The dashboard's own `CLAUDE.md` claimed "file-based everything, no database, agents load from COWORK_PATH at request time." That doc was stale by months. The fix took two more rounds because the convention wasn't documented anywhere a future Claude could find.

This doc fixes that. **Read it before editing any agent.**

## Where things actually live

| Layer | Location | Role |
|---|---|---|
| Disk (canonical) | `$COWORK_PATH/agent personalities/agents/<id>/{identity.md, CLAUDE.md, soul.md}` | Edit here. Git-tracked-via-iCloud (cross-device). PR-reviewable in spirit, even if not in a repo today. |
| DB (cache) | `public.agents` rows: `id`, `name`, `role`, `emoji`, `accent_color`, `identity_md`, `claude_md`, `soul_md`, `domain_keywords`, `sort_order`, `archived`, `tool_tags` | What `getAgents()` and `getAgent(id)` in `dashboard/lib/agents.ts` query at request time. |

`COWORK_PATH` is set in `dashboard/.env.local`. As of 2026-05-03 it points at the iCloud copy:

```
/Users/edmundmitchell/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork
```

## How to edit an agent

1. Open `$COWORK_PATH/agent personalities/agents/<id>/CLAUDE.md` (or `identity.md` / `soul.md`).
2. Make your edits. Keep the structure consistent with the other agents.
3. Run the sync: `node /Users/edmundmitchell/factory/ops/bin/sync-agents.mjs`.
4. Verify with: `SELECT id, length(claude_md) FROM public.agents WHERE id='<agent-id>';` — length should match disk.
5. Test the change in a **new** chat session in the dashboard (not an existing session — agent prompts are loaded per request, but a stale chat may still have the old context in its history).

## How to NOT do it

- Don't `UPDATE public.agents SET claude_md = ...` for permanent changes. Disk and DB will diverge silently and the next sync will undo your DB edit.
- Don't edit `~/factory/CEO cowork/agent personalities/...` — that's a stale duplicate left behind from an earlier directory move. The canonical location is the iCloud `Library/Mobile Documents/...` path. (Future cleanup: delete the factory copy.)
- Don't rely on a hot-reload watcher. There isn't one. Sync is manual.

## What the sync script does

`ops/bin/sync-agents.mjs`:

- Walks `$COWORK_PATH/agent personalities/agents/*/`.
- For each subdirectory containing an `identity.md`:
  - Parses the front-matter (`**Name:**`, `**Role:**`, `**Emoji:**`, `**Accent Color:**`).
  - Reads `CLAUDE.md` (required) and `soul.md` (optional) verbatim.
  - UPSERTs into `public.agents` keyed on `id` (= directory name).
- Prints one line per agent: `synced` | `unchanged` | `error`.
- Idempotent: re-running with no edits is a no-op.
- Does NOT touch `domain_keywords`, `sort_order`, `archived`, `tool_tags` — those columns are managed separately (today, manually via SQL; later, possibly via a sidecar JSON in each agent dir).

## Emergency: the DB drifted from disk

If someone (or a panicked Claude session) directly edited a row in `public.agents`, the next sync will overwrite it. Two recovery options:

1. **Want the disk version to win:** just run the sync. DB returns to whatever's on disk.
2. **Want the DB version to keep:** run `node ops/bin/pull-agent-from-db.mjs <agent-id>` to copy DB → disk first, THEN run the sync (no-op since they now match).

`pull-agent-from-db.mjs` is the inverse of the regular sync. Use it sparingly; it's a recovery tool, not a workflow.

## Future migration (not today)

Move `agent personalities/agents/` from iCloud into `~/factory/agents/` so the source of truth lives in a git repo. Reasons to do it: real PR review, blame, history. Reasons not to do it today: Edmund uses two computers and iCloud handles cross-device sync; moving requires rewriting `COWORK_PATH` and confirming nothing else points at the iCloud path. Tracked, not blocking.

## Quick reference

```bash
# Edit
$EDITOR "$COWORK_PATH/agent personalities/agents/cordis/CLAUDE.md"

# Sync
node /Users/edmundmitchell/factory/ops/bin/sync-agents.mjs

# Verify
psql ... -c "SELECT id, length(claude_md) FROM public.agents WHERE id='cordis';"

# Recover (DB → disk)
node /Users/edmundmitchell/factory/ops/bin/pull-agent-from-db.mjs cordis
```
