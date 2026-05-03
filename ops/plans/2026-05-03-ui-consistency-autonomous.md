# Dashboard UI/UX Consistency — Autonomous Build Plan (rev B, post-Codex review)

**Date:** 2026-05-03
**Repo:** `~/factory/dashboard` (sister repo, deployed to Vercel as `dashboard` — production URL `dashboard-nine-delta-26.vercel.app`)
**Baseline commit:** `24a8dd3` on `origin/main` (6 commits already pushed in this consistency pass)
**Working branch:** `ui-consistency-2026-05-03` (do **not** push directly to `main` — fast-forward at the end after Edmund eyeballs)

---

## Decisions (rev B — incorporates Codex review)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Phase order | **Preflight → EmptyState primitive → Components → Combobox → Responsive → Dark mode → Final verification** | Components consume EmptyState, so primitive comes first. Combobox brings new portal/focus/dark/mobile surface area, so Responsive + Dark-mode audits run *after* it, not before — otherwise they'd need redoing. (Codex flagged: "doing Combobox last means responsive/dark audits may need repeating".) |
| 2 | NativeSelect fate | **Replace, then delete in a separate follow-up commit** | Migrate callsites first; delete only after verification. Reduces blast radius. |
| 3 | Commit cadence | **Phase 1 split into 2 commits** (large/medium files vs small files). Phases 2–5 one commit each. Combobox split into 3: `add Combobox`, `migrate callsites`, `remove NativeSelect`. **Total: 8 commits.** | Codex: 8 components in one commit too coarse to revert. |
| 4 | Push target | **`ui-consistency-2026-05-03` branch**, not `main` | Codex: pushing each phase to `main` publishes intermediate UI to the deployed Vercel app. Branch keeps users on stable until full pass is reviewed. |
| 5 | Verification gate | After each phase: timestamp marker → make changes → curl affected routes → grep dev log *only after marker* → Claude_Preview browser eval for the changed surface. End of run: `pnpm typecheck` + `pnpm build`. | Codex: bare curl misses hydration/client crashes; bare `tail | rg error` re-surfaces stale errors. |
| 6 | Hard-stops (do NOT touch) | `dashboard/app/api/chat/route.ts`, `dashboard/supabase/functions/*`, any pre-existing dirty files captured in preflight | Belongs to a different in-flight workstream. |

**Pattern to follow** (already established in earlier 6 commits): shadcn primitives from `components/ui/*`; outline+colored-tone Badge for status; solid-fill Badge for risk/priority; line-variant Tabs for filter rows; `PageShell.header` for page titles with `border-b`.

---

## Phase 0 — Preflight (do once, before any edits)

```bash
cd ~/factory/dashboard

# 0.1 Snapshot dirty state — anything here is OFF-LIMITS for the run
git status --short > /tmp/ui-pass-preflight.txt
cat /tmp/ui-pass-preflight.txt

# 0.2 Branch off baseline
git fetch origin
git checkout -b ui-consistency-2026-05-03 origin/main

# 0.3 Confirm tooling
node -v && pnpm -v
grep '"@base-ui/react"' package.json   # confirm installed and read its Select export shape
ls node_modules/@base-ui/react/esm/select 2>/dev/null || \
  rg -l 'export.*Select' node_modules/@base-ui/react | head -5

# 0.4 Confirm dev server alive
/usr/bin/curl -s -o /dev/null -w "dev: %{http_code}\n" http://localhost:3000/
# Should be 200. If not, STOP — Edmund's session-start dev server is expected to be up.

# 0.5 Capture log baseline marker
date '+%Y-%m-%dT%H:%M:%S' > /tmp/ui-pass-marker.txt
```

If any preflight check fails, stop and surface it; don't paper over.

---

## Phase 1 — EmptyState primitive

**Why first:** several Phase 2 component refactors (inbox-drop-zone, agent-run-logs) include empty-state markup. Codifying the primitive first avoids rework.

1. Read existing ad-hoc empty states in `/inbox`, `/research`, `/clients` to identify the de-facto pattern (icon + title + sub-copy + optional action).
2. Add `components/ui/empty-state.tsx` with props: `icon?: ReactNode`, `title: string`, `description?: string`, `action?: ReactNode`. Single file. Zero behavior; pure presentation.
3. **No callsite migration in this phase.** Phase 3 does the rollout.

**Verify:** typecheck only (no UI change yet).
```bash
pnpm typecheck 2>&1 | tail -20
```

**Commit:** `ui(dashboard): add shared EmptyState primitive`

---

## Phase 2 — Component refactor sweep

**Targets** (priority order):

| File | Lines | Commit group |
|---|---|---|
| `components/slack/slack-panel.tsx` | 440 | A (big) |
| `components/search/search-dialog.tsx` | 228 | A |
| `components/inbox/inbox-drop-zone.tsx` | 206 | A |
| `components/admin/weekly-review-tile.tsx` | 183 | B (small) |
| `components/inbox/capture-actions.tsx` | 166 | B |
| `components/agents/agent-run-logs.tsx` | 136 | B |
| `components/chat-reasoning.tsx` | 103 | B |
| `components/html-preview.tsx` | 116 | B |

**Process per file:**
1. Read fully.
2. Replace ad-hoc Tailwind with shadcn primitives **where it's a pure swap**. Map ad-hoc status colors to Badge `tone`.
3. **Bounded scope** (Codex callout): if a file uses bespoke nested panel logic, **do not** introduce Dialog/Sheet structural changes — that's behavioral redesign, not the consistency pass. Note "deferred — needs structural review" in the commit body.
4. EmptyState rollout for Phase 2 files happens here (using the Phase 1 primitive); the wider rollout is Phase 3.

**Verify after each commit group:**
```bash
# Curl the routes hosting the touched components
for p in / /chat /inbox /agents /admin/weekly-review; do
  printf "%-25s %s\n" "$p" "$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$p")"
done

# Only NEW errors since the marker
MARKER=$(cat /tmp/ui-pass-marker.txt)
awk -v m="$MARKER" '$0 >= m' dashboard/.next/dev/logs/next-development.log \
  | rg -i 'error|unhandled|hydration|warning' | tail -30

pnpm typecheck 2>&1 | tail -10
```

Then a browser-level smoke (catches client crashes curl misses) using the Claude_Preview MCP — open one route hosting each touched component, eval `document.title`, screenshot.

**Commits:**
- `ui(dashboard): refactor large components to shadcn primitives (slack/search/inbox-drop-zone)`
- `ui(dashboard): refactor remaining components to shadcn primitives`

**Refresh marker** after the second commit: `date '+%Y-%m-%dT%H:%M:%S' > /tmp/ui-pass-marker.txt`

---

## Phase 3 — EmptyState rollout to remaining pages

**Inventory first, edit second** (Codex: prevents "every list/grid surface" from becoming app-wide archaeology):

```bash
rg -l 'No (results|items|tasks|messages|matches|entries)|empty|nothing here' dashboard/app dashboard/components | tee /tmp/empty-state-inventory.txt
```

Freeze that list; replace ad-hoc empties with `<EmptyState />` only on those files. Skip: pages that legitimately can't be empty (`/metrics`); files already using EmptyState from Phase 2.

**Verify:**
- Curl all top-level pages (200 across the board).
- For 1–2 pages with reliably empty data in dev (`/research`, `/clients` — if confirmed empty), open in Claude_Preview, screenshot, eyeball.
- Empty branches that need seeded data to test: note in commit body, defer visual eyeball to final report.

**Commit:** `ui(dashboard): unified EmptyState across list surfaces`

---

## Phase 4 — Combobox (replaces NativeSelect)

**Three commits:**

### 4a. Add Combobox primitive
Build `components/ui/combobox.tsx` on `@base-ui/react` Select (verified in preflight). Drop-in API mirroring NativeSelect: `value`, `onChange`, `options: {value, label}[]`, optional `searchable`. Include ARIA labels, keyboard nav (Arrow/Enter/Escape), focus ring matching shadcn Input.
**Verify:** typecheck.
**Commit:** `ui(dashboard): add Combobox primitive (base-ui Select)`

### 4b. Migrate callsites
Order (smallest blast radius first):
1. `app/changelog/page.tsx`
2. `app/workspace/page.tsx`
3. `app/chat/page.tsx`

**Verify per callsite:**
- Curl page → 200.
- Claude_Preview: open page, click the combobox, arrow-key + Enter to select an option, confirm value updates and panel closes. Screenshot light + dark.
- Tail dev log (post-marker) for hydration warnings — Base UI portals are a known source.

**Commit:** `ui(dashboard): migrate select callsites to Combobox`

### 4c. Remove NativeSelect
```bash
rg -n 'native-select|NativeSelect' dashboard
```
Should return zero hits. If clean, delete `components/ui/native-select.tsx` and any unused export from `components/ui/index.ts`.
**Verify:** typecheck + `pnpm build`.
**Commit:** `ui(dashboard): remove NativeSelect (replaced by Combobox)`

---

## Phase 5 — Responsive sweep

**Goal:** two-pane layouts degrade gracefully at <768px.

**Inventory first:**
```bash
rg -l '(lg|md|xl):grid-cols-' dashboard/app dashboard/components | tee /tmp/responsive-inventory.txt
```

Classify each: must-fix (two-pane breaks <768) vs note-only (decorative grid that already wraps). Edit only must-fix.

**Test viewports (Codex: UA spoofing doesn't change CSS breakpoints):**
- Use Claude_Preview `preview_resize` to 375 (mobile), 768 (tablet), 1024 (desktop) for each must-fix route.
- Screenshot at each width.

**Commit:** `ui(dashboard): responsive pass on two-pane layouts`

---

## Phase 6 — Dark-mode audit

**Static grep** (catches the obvious):
```bash
rg -n 'text-(amber|emerald|rose|sky|violet|fuchsia|orange|lime)-(50|100|200|300|400|500|600|700|800|900)\b' dashboard/app dashboard/components | rg -v 'dark:'
rg -n 'bg-(amber|emerald|rose|sky|violet|fuchsia|orange|lime)-(50|100|200|300|400|500|600|700|800|900)\b' dashboard/app dashboard/components | rg -v 'dark:'
```

For each hit:
- Status/severity → migrate to Badge `tone` (single source of truth).
- Decorative → add `dark:` counterpart.

**Visual check** (static grep misses CSS vars, `cn()` branches, SVG fills):
- Open each top-level page in Claude_Preview, toggle theme via theme-picker, screenshot light + dark.
- Spot any contrast regressions; fix or note.

**Commit:** `ui(dashboard): dark variants on custom tone classes; status colors via Badge tones`

---

## Phase 7 — Final verification + report

```bash
# All routes 200
for p in / /tasks /workspace /agents /chat /changelog /inbox /inbox/promotions /research /metrics /clients /files /compression /voice /admin/weekly-review; do
  printf "%-30s %s\n" "$p" "$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$p")"
done

# Production gate (Codex: dev hides prod-only failures)
pnpm typecheck
pnpm build 2>&1 | tail -40
```

Final report → `~/factory/ops/reports/2026-05-03-ui-consistency-autonomous.md` (yes, this path is in the **factory** repo, not dashboard — that's intentional; Edmund's reports live there). Include:
- Phases completed vs deferred
- Commit list with SHAs
- Surfaces that need Edmund's eyeball (mobile spot-checks, dark-mode visual on data-heavy pages)
- Anything skipped with reason

**Self-review** (per the no-self-review law — pipe to Codex):
```bash
git diff 24a8dd3..HEAD | codex exec --skip-git-repo-check \
  "Review this dashboard UI consistency pass. Find regressions, accessibility gaps, missed primitives, and any place ad-hoc styling slipped past the migration."
```

**Push (after Edmund's go-ahead, or autonomously if explicitly authorized):**
```bash
git push -u origin ui-consistency-2026-05-03
gh pr create --base main --head ui-consistency-2026-05-03 --title "UI consistency pass — components, EmptyState, Combobox, responsive, dark mode" --body "$(cat ops/reports/2026-05-03-ui-consistency-autonomous.md)"
```

---

## Rollback (per phase)

If a phase verification fails and a fix isn't obvious within 2 attempts:
1. `git log --oneline ui-consistency-2026-05-03 ^origin/main` → identify the bad commit.
2. `git revert <sha>` (creates a new commit; preserves history).
3. Note the skipped phase in the final report; continue with subsequent phases that don't depend on it.

If multiple phases need rollback, abandon the branch:
```bash
git checkout main && git branch -D ui-consistency-2026-05-03
```
No `--force` needed since nothing is pushed yet.

---

## Cross-cutting rules

- **Branch:** `ui-consistency-2026-05-03`. Push only at the end.
- **No `git add -A`** at any level. Always name files. The factory worktree has dirty files from a parallel session; Phase 0 captures them as off-limits.
- **No new dependencies.** `@base-ui/react` is already installed.
- **No commits of `.next/`, logs, or lockfile changes** unless intentional.
- **Don't `git push` to `main`.** Don't open a PR until Edmund eyeballs at the end.
- **Hard blocker rule:** if a phase blocks (compile error you can't resolve in 2 attempts, or behavior regression with no clear fix), commit what's safe to a separate `wip/` filename, skip the rest of that phase with a TODO, finish remaining phases, and surface in the final report.

---

## Verification snippets (reuse across phases)

```bash
# Refresh the log marker before each phase
date '+%Y-%m-%dT%H:%M:%S' > /tmp/ui-pass-marker.txt

# Curl all top-level pages
for p in / /tasks /workspace /agents /chat /changelog /inbox /inbox/promotions /research /metrics /clients /files /compression /voice /admin/weekly-review; do
  code=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$p")
  printf "%-30s %s\n" "$p" "$code"
done

# Only NEW errors since the marker
MARKER=$(cat /tmp/ui-pass-marker.txt)
awk -v m="$MARKER" '$0 >= m' dashboard/.next/dev/logs/next-development.log \
  | rg -i 'error|unhandled|hydration|warning' | tail -30
```

---

## Paste-ready execute prompt

```
Execute the plan at ops/plans/2026-05-03-ui-consistency-autonomous.md autonomously.

Order: Phase 0 (preflight) → Phase 1 (EmptyState primitive) → Phase 2 (component refactor, 2 commits) → Phase 3 (EmptyState rollout) → Phase 4 (Combobox, 3 commits) → Phase 5 (responsive) → Phase 6 (dark mode) → Phase 7 (final verification + report).

After each phase: run the verification block in that phase. Refresh the log marker between phases. Stay on branch ui-consistency-2026-05-03; do NOT push to main and do NOT open a PR — Edmund eyeballs first.

Hard blockers per the plan's blocker rule. Hard-stops per the plan's hard-stop list.

End: write final report to ~/factory/ops/reports/2026-05-03-ui-consistency-autonomous.md. Then run the Codex self-review per Phase 7. Surface the report path and the Codex output in the final message.
```
