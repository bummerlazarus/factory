# Plan — Workspace ↔ Files ↔ Research cross-linking

**Date:** 2026-05-03
**Driver:** Edmund's report — Sophia opened a project + tasks in the `factory` workspace and "generated some reports," but he couldn't find them on the Files page.
**Goal:** make agent-produced artifacts discoverable from the surfaces where the user is already looking.

---

## 1. What's actually happening (diagnosis)

Three independent storage layers, no cross-links:

| Layer | What lives there | Surfaced by |
|---|---|---|
| **Disk (`COWORK_PATH` + `dashboard/docs/`)** | Markdown files written by the `write_file` tool, agent personalities, hand-authored docs. | `/files` page (`Cowork Files` + `Project Docs` tabs). |
| **Supabase `workspace_items`** | Plans / Projects / Tasks / Scopes (the things shown on `/workspace`). Has a manual `target_files: text[]` column and a self-referential `project_id`. | `/workspace` page. |
| **Supabase `reference_docs`** | Sophia's research briefs (kind = research/research-brief), Augustin's syntheses, client scope docs, etc. | `/research` page (and `/research/[id]` detail). |

**Why Sophia's reports look "missing":**
- `sophia_research` calls the `researcher-run` Edge Function, which inserts into `reference_docs`, **not** disk and **not** `workspace_items`. (Confirmed at `dashboard/lib/tools.ts:1209-1213` and the `researcher-run` Edge Function.)
- Nothing on the `/files` page reads `reference_docs`, so the briefs are invisible there.
- Even on `/workspace`, the project Sophia opened has no link to the briefs she produced — there is no FK from `reference_docs` back to the project, and `target_files` (an opt-in path array) is never auto-populated.
- Same gap applies in reverse: a `research-brief` row has no idea which project it served.

The reports DO exist — they're on `/research`. The bug is **discoverability**, not data loss.

## 2. What "fixed" looks like

A user looking at any of the four surfaces — a project on `/workspace`, a task, a research brief on `/research`, or a file on `/files` — can see (and click through to) every artifact related to it, regardless of which storage layer it lives in.

Concretely:
1. The `/workspace` project detail shows: child tasks, attached files (disk), produced research briefs (`reference_docs`), all clickable.
2. The `/research` brief shows: which project/task spawned it, with a clickable badge.
3. The `/files` page exposes a unified view that includes Cowork files, project docs, AND `reference_docs`-backed virtual files — with a project filter.
4. When an agent runs a tool while a project/task is "active context," the resulting artifact is auto-linked to that project. No manual `target_files` editing.

## 3. Build plan (autonomous, ~one evening) — revised after Codex review

Codex review (2026-05-03) caught five real issues; this section reflects the revisions. Original draft is preserved in git history.

### Phase 0 — Give `workspace_items` a real primary key
**Why:** today the app upserts on `(slug, department, type)` in [`lib/workspace.ts:56`](dashboard/lib/workspace.ts:56) and stores `project_id` as a slug. We can't FK to `slug` reliably, and Codex called out that we should stop deepening the slug-as-id pattern. Doing this first means every later phase has a clean target.

- Migration `027_workspace_items_id.sql`:
  - `alter table workspace_items add column id uuid not null default gen_random_uuid();`
  - Add unique index on `id`; keep existing `(slug, department, type)` upsert key as a unique constraint.
  - Backfill any null ids in the same migration (default handles it).
- Update `lib/workspace.ts` types to include `id`. Reads stay slug-keyed for now (no behavior change for the UI).

### Phase 1 — Schema: typed `artifact_links`
**Why first after Phase 0:** every later phase needs the link.

- Migration `028_artifact_links.sql`:
  ```sql
  create table public.artifact_links (
    id uuid primary key default gen_random_uuid(),
    workspace_item_id uuid not null references workspace_items(id) on delete cascade,
    -- exactly one of these is set:
    reference_doc_id uuid references reference_docs(id) on delete cascade,
    disk_path text,
    created_at timestamptz not null default now(),
    created_by text,
    constraint artifact_links_one_target check (
      (reference_doc_id is not null)::int + (disk_path is not null)::int = 1
    ),
    unique (workspace_item_id, reference_doc_id),
    unique (workspace_item_id, disk_path)
  );
  create index on public.artifact_links (reference_doc_id);
  create index on public.artifact_links (disk_path);
  ```
- Typed columns (per Codex) instead of polymorphic `(kind, ref)` text. Cascade deletes keep us honest if a research brief is removed. `memory_row` deferred (Codex: scope creep).
- RLS: enable RLS, no policies for anon. All reads/writes go through API routes using the service-role client at [`lib/supabase.ts:1`](dashboard/lib/supabase.ts:1) — same pattern the rest of the app uses.

### Phase 2 — Active-context plumbing (chat AND agent-runner)
**Why:** auto-linking only works if the executing layer knows what project it's serving. Codex flagged that `executeTool` is also called by `agent-runner` and wake/cron paths — chat alone isn't enough.

- Extend `executeTool(name, input, agentId)` signature → `executeTool(name, input, ctx: { agentId; activeWorkspaceItemId?: string })`. Update every caller (chat route, agent-runner, wake-queue drain).
- Add `activeWorkspaceItemId?: string` to `/api/chat` request body.
- Frontend: when chat is opened from a workspace project (explicit "Work in this project" toggle, default off — addresses the staleness risk), pass the id. Clear on navigate.
- For non-chat agent runs (autonomous, wake-fired), accept `activeWorkspaceItemId` in the run payload.

### Phase 3 — Auto-linking from key tools
Inside `executeTool`, when `ctx.activeWorkspaceItemId` is set:
- `sophia_research` → after the Edge Function returns, `insert into artifact_links (workspace_item_id, reference_doc_id)` using the returned `reference_docs.id`.
- `augustin_synthesize` → same pattern.
- `write_file` → `insert into artifact_links (workspace_item_id, disk_path)` with the relative path under COWORK_PATH.

`on conflict do nothing` so re-runs are safe. Missing context = today's behavior.

### Phase 4 — UI: artifacts on the project view
**Note:** today `/workspace` is a single client page at [`app/workspace/page.tsx:1`](dashboard/app/workspace/page.tsx:1) — there is no `/workspace/<slug>` route. Codex flagged that any reverse link to "the project page" needs a real target.

- Pick the lightweight option: keep the single page, but encode selection in the URL — `/workspace?item=<id>` opens with that item's detail panel expanded. Two-line change in the existing client.
- New API: `GET /api/workspace/[id]/artifacts` → returns `{ files: [...], research: [...] }` joined from `artifact_links`. (Server route, service-role client.)
- Project detail panel gains an "Artifacts" section with two groups: **Files** (link to `/files?open=…`) and **Research** (link to `/research/[id]`).
- Add a manual **"Link to project…"** action on each group — Codex was right that backfill is weak; manual linking should ship up front.

### Phase 5 — Reverse badge + Files filter (no third tab)
Codex: a Research tab on Files implies Research is a file source. It isn't. Cut.
- `/research/[id]/page.tsx`: render a "Linked to" badge for any `workspace_items` joined via `artifact_links` → click goes to `/workspace?item=<id>`.
- `/files/files-client.tsx`: add a project filter dropdown only. When a project is selected, the existing Cowork Files / Project Docs tabs filter to paths present in `artifact_links` for that project, and a small inline **Research from this project** group appears above the file tree (links to `/research/[id]`). One unified surface, no new tab metaphor.

### Phase 6 — Backfill (last, after manual-link UI exists)
- One-shot `dashboard/scripts/backfill-artifact-links.mjs`:
  - For `reference_docs` where `metadata->>'project_slug'` resolves to a `workspace_items.slug`: insert a link.
  - For `workspace_items.target_files[]` entries that resolve to a real file under COWORK_PATH: insert a `disk_path` link.
- Idempotent via unique constraints. Print counts; spot-check.
- Codex was correct that `metadata.project_slug` may be sparse — this is best-effort cleanup, not the primary path. The primary path is auto-linking (Phase 3) and manual linking (Phase 4).

### Phase 7 — Docs + memory updates
- Update `dashboard/CLAUDE.md` "Workspace Documents" section to describe the join table.
- Update `factory/CLAUDE.md` "Where things live" to include `/research` next to `/files`.
- Save a new `reference_…` memory note pointing at this plan + the join table.

## 4. Out of scope for tonight
- Replacing `target_files` (it stays as a manual hint; the join table supersedes it for new writes but we don't migrate yet).
- Moving `workspace_items` off Supabase or unifying with `reference_docs`.
- Any iCloud / COWORK_PATH path changes.
- Inbox / Slack / email surfaces. Per memory: dashboard-as-primary-surface.

## 5. Risks
- **Active-context staleness:** if the user navigates around, the slug we pass with chat could be wrong, leading to incorrect links. Mitigation: only set the slug when chat is actively scoped to a project (explicit "Work in this project" toggle), default off.
- **Phase 1 unique constraint** could reject valid relinks (same artifact moves projects). Mitigation: use `on conflict do nothing`; expose unlink action in UI.
- **Polymorphic ref** has no DB-level integrity for `reference_doc` rows. Mitigation: nightly check job that flags dangling links (low priority).

## 6. Verification per phase
- Phase 0: `select id from workspace_items limit 5` returns uuids; existing /workspace page still loads.
- Phase 1: migration applies cleanly; `insert into artifact_links` with both targets null fails the check; with both set fails the check.
- Phase 2: chat request with `activeWorkspaceItemId` round-trips through `/api/chat` → `executeTool`. Curl test. Agent-runner accepts the same field.
- Phase 3: invoke `sophia_research` with active context; row appears in `artifact_links` with the returned `reference_doc_id`.
- Phase 4: `/workspace?item=<id>` opens the right detail panel; Artifacts section lists at least one Research entry; click → `/research/[id]` loads.
- Phase 5: reverse badge renders on `/research/[id]`; Files page project filter narrows the tree and shows a Research group inline.
- Phase 6: backfill prints counts; spot-check one project shows expected links.

---

**Ready-to-paste prompt for the executing session:**

> Execute `ops/plans/2026-05-03-workspace-files-cross-linking.md` end-to-end. After each phase, run the listed verification step before moving on. When all phases are done, re-read the plan, confirm every checkbox is satisfied, and run `npm run lint` + `npm run build` from `dashboard/`. Commit per phase with conventional messages. Do not push or open a PR — leave commits local for Edmund to review.
