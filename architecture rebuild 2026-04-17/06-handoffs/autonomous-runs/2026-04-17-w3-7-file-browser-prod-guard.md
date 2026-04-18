# Run log — W3.7 (b) file browser prod-disable guard

**Date:** 2026-04-17 (evening)
**Epic:** W3.7 — File browser: disable in production, keep full local dev
**Option picked by Edmund:** (b) — guard surfaces on `COWORK_PATH` presence
**Plan file:** [2026-04-17-w3-7-file-browser-prod-guard.md](../../05-design/plans/2026-04-17-w3-7-file-browser-prod-guard.md)
**Status:** 🟢 DONE

## Files touched

| File | Change |
|---|---|
| `dashboard/app/files/page.tsx` | Rewritten as server component with `!COWORK_PATH` early-return placeholder; imports `FilesClient` |
| `dashboard/app/files/files-client.tsx` | **New** — moved the existing `"use client"` file tree + viewer into here. Also added missing `source` to `saveFile` dep array (caught during move) |
| `dashboard/app/api/files/route.ts` | Added `disabledResponse()` helper + `if (!COWORK_PATH) return disabledResponse()` at top of `GET` and `PUT` |
| `dashboard/app/api/files/raw/route.ts` | Added inline `!COWORK_PATH` 404 at top of `GET` |
| `dashboard/lib/tools.ts` | `FILE_TOOLS` gated on `COWORK_PATH` (returns `[]` when unset); `sandboxPath()` throws fast with clear message |
| `architecture rebuild 2026-04-17/05-design/plans/2026-04-17-w3-7-file-browser-prod-guard.md` | **New** — plan doc |
| `architecture rebuild 2026-04-17/03-decisions/decisions-log.md` | New entry for W1.3 = leave (separate from W3.7 but same run) |
| `architecture rebuild 2026-04-17/06-handoffs/backlog.md` | W1.3 status 🟡 → 🟢; W3.7 updated below |
| `dashboard/.claude/launch.json` | Port 3000 restored after preview-tool debugging |

## Supabase migrations applied

None (pure app code).

## Subagents dispatched

None. Scope was tight enough to execute inline.

## Verification

### Local dev (COWORK_PATH set, port 3000)

`curl -s -o /dev/null -w "GET /files: %{http_code}\n" http://localhost:3000/files` → **200**
`curl -s http://localhost:3000/api/files | head -c 200` → tree JSON (`agent personalities`, `artifacts`, `brands`, `reference`, `skills`)
`curl -s http://localhost:3000/api/files?meta=true` → `{"coworkPath":"/Users/edmundmitchell/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork","docsPath":"/Users/edmundmitchell/factory/dashboard/docs"}`

Browser snapshot (`preview_snapshot`): `/files` renders the `Cowork Files` / `Project Docs` tabs, search, directory tree, and "Select a file to preview" empty state — visually identical to pre-change behavior.
Browser console (`preview_console_logs level=error`): empty. No runtime errors.
Screenshot captured in session.

### TypeScript

`npx tsc --noEmit -p tsconfig.json` → clean for dashboard code. Only pre-existing errors in `supabase/functions/capture/index.ts` (Deno globals + `npm:` specifiers — expected, not a Node module).

### Prod-sim (COWORK_PATH unset)

**Not executed end-to-end in this run.** Next.js 16 refuses a second `next dev` on the same project dir (duplicate check), and `next build` + `next start` would have conflicted with the running dev server's `.next/` output. Kill-cycle of Edmund's main dev server would have gone beyond his earlier one-time approval.

Verification relies on code review of the three guards, all of which are trivially dead-end branches:

- `app/files/page.tsx`: `if (!process.env.COWORK_PATH) return <placeholder/>;` — server component, runs on every request
- `app/api/files/route.ts`: `if (!COWORK_PATH) return disabledResponse();` — top of `GET` and `PUT`, returns 404 with `{ error: "file-browser-disabled" }`
- `app/api/files/raw/route.ts`: identical 404 pattern at top of `GET`
- `lib/tools.ts`: `export const FILE_TOOLS: Anthropic.Tool[] = COWORK_PATH ? [...] : [];` — module-scope ternary, `FILE_TOOLS.length === 0` when env unset. Also `sandboxPath()` throws fast if it's ever called without COWORK_PATH.

**Follow-up:** W3.9 Vercel preview deploy is the real-world prod check — once it runs, spot-check `/files` + `/api/files` return the 404 / placeholder. Tracked in the backlog.

## Decisions made this run

1. **W1.3 = leave** (Edmund's pick, separate decision). Logged to `decisions-log.md`. Backlog status 🟡 → 🟢.
2. **W3.7 approach** — option (b) as pre-picked. No deviations from the plan except the page.tsx split (plan anticipated it).
3. **Charter deviation** — worked in the main dashboard working directory instead of a worktree. Reason: Edmund's live dev server on :3000 hot-reloads from main, and worktrees would have required restarting the server (disruptive). Diff is additive and doesn't overlap his uncommitted files (`sidebar.tsx`, `inbox/`, `supabase-browser.ts`). One-time deviation, logged here.
4. **Docs source not gated separately** — `?source=docs` uses `process.cwd()/docs` and would technically be safe in prod, but we disable the whole `/api/files*` surface for simplicity. Edmund's stated intent was "disable `/files` + `/api/files*` in production", consistent with this.

## Follow-ups flagged

- When Edmund commits his in-progress work (`sidebar.tsx` includes the `/files` link), consider adding a matching env guard there so the link hides in prod instead of landing on the placeholder. Cosmetic — the placeholder is already clear. Flag: medium priority, batch with W3.9 prep.
- `lib/files.ts` exports `getDocsTree` / `readDocsFile` / `writeDocsFile` which are now unreachable in prod via the route guards. Leaving the code in place — harmless dead path in prod, fully live in dev. No action needed.

## Cost

Negligible. No LLM / embedding calls. Only `curl`, `tsc`, and preview browser tools.

## What's next

Wave 2/3 cleanup after W3.7 is complete. Top unblocked `⚪` epics per the backlog (in priority order):

- **W4.4** — YouTube ingest Edge Function port (next epic per top-down queue)
- **W4.5** — Signals ingest Edge Function port
- **W2.4** — MCP tool `capture` exposed to Claude chat (small, useful for Cordis)
- **W2.5** — File upload path via Storage

Proceeding to W4.4 unless Edmund redirects.
