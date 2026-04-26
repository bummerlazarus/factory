# W3.7 — File browser prod-disable guard (option b)

**Date:** 2026-04-17
**Epic:** W3.7 — Disable `/files` + `/api/files*` in production while preserving full local-dev edit/write/delete
**Size:** S (<2h)

## Intent

Edmund picked option (b) for W3.7. In **local dev** (where `COWORK_PATH` is set to the iCloud CEO Cowork folder) the file browser stays fully functional: tree, view, edit, write, delete, search. In **production** (where `COWORK_PATH` is unset), the entire `/files` UI and `/api/files*` surface must be inert and safe.

Motivation is twofold:
1. **UX** — there's no file-system content in prod. The page should render a clear "disabled in this environment" state instead of fetch errors.
2. **Security** — without guards, `path.resolve("", userPath)` falls back to the deployed app's cwd. A sandboxPath() whose root is `process.cwd()` is a path-traversal risk. Gate it.

## Scope

Touched files:

| File | Change |
|---|---|
| `app/files/files-client.tsx` (new) | Renamed client component out of `page.tsx` |
| `app/files/page.tsx` | Becomes a server component: renders placeholder when `!COWORK_PATH`, otherwise renders `<FilesClient />` |
| `app/api/files/route.ts` | Early 404 `file-browser-disabled` when `!COWORK_PATH` |
| `app/api/files/raw/route.ts` | Early 404 `file-browser-disabled` when `!COWORK_PATH` |
| `lib/tools.ts` | `FILE_TOOLS` becomes `[]` when `!COWORK_PATH`; `sandboxPath()` throws fast with a clear message |

Not touched:
- `components/layout/sidebar.tsx` — Edmund has uncommitted changes; the `/files` link stays but lands on the placeholder
- `lib/files.ts` — no guard needed; not reachable once routes 404
- Any `docs` source logic — disabled alongside `cowork` for simplicity (docs is a repo-local preview feature, not a prod need)

## Contract

**Dev (`COWORK_PATH` set):** identical to today. `/files` loads tree, view, edit, save, search all work; agent tools `list_directory` / `read_file` / `write_file` / `move_file` / `rename_file` / `create_directory` / `delete_file` all work.

**Prod (`COWORK_PATH` unset):**
- `GET /files` → 200, renders placeholder: "File browser is disabled in this environment."
- `GET /api/files*` → 404 with `{ error: "file-browser-disabled", message: "…" }`
- `PUT /api/files` → 404 same payload
- `GET /api/files/raw` → 404 same payload
- Any agent calling `list_directory` / `read_file` / `write_file` / etc. → tool not present in `FILE_TOOLS` → Claude won't try it; if the tool list is stale, `sandboxPath()` throws "File tools disabled: COWORK_PATH not configured" which the tool runner serializes as an error result.

## Acceptance criteria

1. Local dev smoke: `curl -s http://localhost:3000/api/files | jq '.[].name'` returns the cowork tree (unchanged behavior).
2. Local dev page: `GET /files` returns 200 HTML with the `<FileBrowser />` React tree (unchanged visual).
3. Prod simulation: run dev server with `COWORK_PATH=""` explicit → `curl -s http://localhost:3000/api/files` returns `{"error":"file-browser-disabled",...}` with status 404, and `GET /files` returns the placeholder.
4. `lib/tools.ts` self-test: with `COWORK_PATH` unset, `FILE_TOOLS.length === 0`.
5. TypeScript compile succeeds (`npm run lint` or a targeted `tsc --noEmit` on touched files).

## Verification steps

1. Start dev server (already running, PID captured in run log).
2. Local dev:
   ```
   curl -s "http://localhost:3000/api/files" | head -c 200
   curl -s -I "http://localhost:3000/files"
   ```
3. Prod simulation (new shell):
   ```
   cd /Users/edmundmitchell/factory/dashboard && COWORK_PATH="" npx next dev -p 3100 &
   sleep 5
   curl -s -w "\n%{http_code}\n" "http://localhost:3100/api/files"
   curl -s -w "\n%{http_code}\n" "http://localhost:3100/api/files/raw?path=foo"
   curl -s -I "http://localhost:3100/files" | head -1
   kill %1
   ```
4. Screenshot the placeholder if UI verification is needed (skippable — visual text is trivial).

## Rollback

Single commit. `git revert` returns to current behavior.

## Why not a worktree

Edmund's running dev server on :3000 hot-reloads from the main working directory; verification against a worktree would require restarting the server and losing his open session state. W3.7 diff is tight, additive, and touches files that don't overlap with Edmund's uncommitted work (`sidebar.tsx`, `inbox/`, `supabase-browser.ts`, etc.). Acceptable charter deviation — logged in run file.
