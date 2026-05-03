# Dashboard UI/UX Consistency — Autonomous Run Report

**Date:** 2026-05-03
**Plan:** [`ops/plans/2026-05-03-ui-consistency-autonomous.md`](../plans/2026-05-03-ui-consistency-autonomous.md)
**Branch:** `ui-consistency-2026-05-03` (in `~/factory/dashboard`, **not pushed**)
**Baseline:** `24a8dd3` (origin/main at run start)

## Phases — completed vs deferred

| Phase | Status | Notes |
|---|---|---|
| 0 — Preflight | ✅ | Dirty files snapshotted to `/tmp/ui-pass-preflight.txt`; left untouched |
| 1 — EmptyState primitive | ✅ | `components/ui/empty-state.tsx` |
| 2 — Component refactor (group A: large) | ✅ | slack-panel + search-dialog migrated; **inbox-drop-zone deferred** (bespoke window-level drag overlay; no clean primitive swap) |
| 2 — Component refactor (group B: small) | ✅ | capture-actions / agent-run-logs / chat-reasoning / html-preview migrated; **weekly-review-tile left as-is** (already on Card; tones already dark-aware) |
| 3 — EmptyState rollout | ✅ | `/tasks`, `/inbox` captures-list. Skipped: `/metrics` (per plan), workstream-tile inline italic hint, home today-tile (not a list surface) |
| 4 — Combobox primitive | ✅ | `components/ui/combobox.tsx` on `@base-ui/react/select` (proper portal, ARIA, keyboard nav) |
| 4 — Combobox migration | ✅ | `/changelog`, `/workspace`, `/chat` "+ New Chat..." launcher |
| 4 — Remove NativeSelect | ✅ | Deleted; `pnpm build` clean (only pre-existing next.config.ts NFT noise) |
| 5 — Responsive sweep | ⚠️ partial | Home stats and quick-actions collapse to single column at <640px. **Two-pane sidebars (chat, workspace, files) deferred** — needs structural redesign (sidebar collapse + mobile menu trigger) out of scope for this pass |
| 6 — Dark-mode audit | ✅ | 14 files patched; `text-{color}-{500/600/700}` now ships `dark:text-{color}-400`. Solid-saturated dots and `bg-emerald-600 text-white` toast left as-is (legible both modes) |
| 7 — Final verification | ✅ | All 14 top-level routes 200; `npx tsc --noEmit` clean; `pnpm build` succeeds (one pre-existing NFT warning) |

## Commit list (10 commits on branch)

```
8219a12 ui(dashboard): dark variants on custom tone classes; status colors via Badge tones
1cc3105 feat(llm): cheap tier → anthropic/claude-haiku-4-5      ← NOT FROM THIS RUN
1b53504 ui(dashboard): responsive pass on home grids
792c489 ui(dashboard): remove NativeSelect (replaced by Combobox)
9f869e0 ui(dashboard): migrate select callsites to Combobox
256be0d ui(dashboard): add Combobox primitive (base-ui Select)
64c2e02 ui(dashboard): unified EmptyState across list surfaces
5510867 ui(dashboard): refactor remaining components to shadcn primitives
ccabcaa ui(dashboard): refactor large components to shadcn primitives (slack/search)
fd07461 ui(dashboard): add shared EmptyState primitive
```

> **Note on `1cc3105`:** that commit landed on this branch from a parallel session (cost-routing work) while the run was in flight. It's a single-line llm.ts tier swap, unrelated to UI work. Not reverted — but called out so the eyeball pass knows that one commit isn't from this plan.

## Surfaces that need Edmund's eyeball

These weren't covered by automated curl/typecheck/build verification — please look:

1. **`/inbox` empty state** — when captures table is empty (locally or in fresh dev), the new `EmptyState` should render the FileText icon, "No captures yet" title, and the long capture-API description. Sub-components like the workstream-tile inline empty hint were intentionally left as-is.
2. **`/tasks` empty state** — same primitive applied; opens cleanly when no agent tasks exist.
3. **`/changelog` filter dropdowns** — two new Combobox triggers in the header (agent + type). Click each, arrow-key down, Enter — confirm option selects + popup closes + filter applies. Portal target is `<body>`, so it should escape any `overflow:hidden` ancestors.
4. **`/workspace` "Add new" form** — Status and Risk pickers are now Combobox. Verify form submit still receives the right value.
5. **`/chat` "+ New Chat..." launcher** — Combobox with an empty controlled value. After picking an agent, the new session should be created and the trigger should re-render with the placeholder again. Watch for any Base UI portal hydration warnings in the console (the plan flagged this as a known risk).
6. **Slack panel (`/`)** — open the agent comms panel, switch channels with no messages, confirm the new EmptyState renders with the MessageSquare icon. Send a message; confirm the Send button is now the shadcn Button.
7. **Cmd+K search dialog** — open the palette empty (placeholder copy from EmptyState), type a query that returns nothing (EmptyState with SearchIcon), then a query that hits.
8. **Dark mode** — toggle theme on `/changelog`, `/tasks`, `/research`, `/inbox`, `/inbox/promotions`, `/compression`, `/clients`. Status badges (amber/emerald/violet/indigo/pink/blue) should now have legible text in dark mode (was washed-out before). Verified via grep, not pixels — visual eyeball recommended.
9. **Mobile spot-checks (375 px)** — `/` should now stack stats and quick-actions to single column. Two-pane pages (chat / workspace / files) are still desktop-locked and will horizontally scroll.

## Skipped / deferred (with reason)

- **inbox-drop-zone.tsx** — bespoke window-level drag overlay + ephemeral toast. No clean primitive swap; a structural redesign would be its own task.
- **weekly-review-tile.tsx** — already on Card primitive; status amber/emerald already had dark counterparts.
- **/metrics empty states** — surface can't legitimately be empty once any tracking exists (per plan).
- **workstream-tile CaptureList empty** — single-line italic hint inside a sub-card; full EmptyState chrome would be too heavy.
- **Two-pane responsive (chat/workspace/files)** — needs sidebar-collapse + mobile-menu structural redesign; out of scope for a primitive-swap consistency pass.
- **Solid saturated bg-color-500 dots** — decorative status indicators that read fine in both light and dark.

## Hard-stops encountered

None. No phase blocked beyond the 2-attempt threshold.

## Verification at end of run

- `npx tsc --noEmit` → clean
- `pnpm build` → success (only pre-existing next.config.ts NFT warning)
- All 14 top-level routes (`/`, `/tasks`, `/workspace`, `/agents`, `/chat`, `/changelog`, `/inbox`, `/inbox/promotions`, `/research`, `/metrics`, `/clients`, `/files`, `/compression`, `/voice`) → HTTP 200

## Codex self-review (post-run)

Run: `git diff 24a8dd3..HEAD | codex exec --skip-git-repo-check "Review this dashboard UI consistency pass..."`

Findings (verbatim, lightly trimmed):

- **`components/ui/combobox.tsx:24`** — no `id` / `aria-labelledby` support, so visible labels in `app/workspace/page.tsx:339` and `:365` aren't programmatically associated. `aria-label` works but the migration missed the visible-label path.
- **`components/ui/combobox.tsx:75`** — `key={opt.value}` breaks if two options share the same value (e.g. repeated sentinel `""`). Use value + index, or require unique IDs.
- **`components/ui/empty-state.tsx:32`** — `description?: React.ReactNode` renders inside a `<span>`. Block nodes (lists, paragraphs) inside would be invalid HTML. Use a `<div>` or constrain the prop type.
- **`app/chat/page.tsx:316`** — controlled select with `value=""` forever. Confirm Base UI fires `onValueChange` when the same agent is picked twice in a row (native select reset via `e.target.value = ""` was a different code path).
- **`app/research/[id]/page.tsx:133`** — status/gate/approved/rejected pills still ad-hoc `<span>`. Should use `Badge`. Missed by my pass.
- **`app/research/research-actions.tsx:42`** — approve/reject buttons still raw `<button>` with hand-written sizing/colors/focus. Missed `Button size="icon-sm"`.
- **`components/search/search-dialog.tsx:192`** — result rows still raw `<button>` with bespoke hover/focus. Close button was migrated, list items weren't.
- **`components/slack/slack-panel.tsx:137`** — channel tabs are raw `<button>`. Could be the `Tabs` primitive or a shared segmented control.
- **`components/html-preview.tsx:33`** — `Badge className="bg-primary/10 text-primary"` overrides the default variant's bg/fg. Prefer `variant="secondary"`/`outline"` or add a real Badge tone.
- **Tone maps still duplicated inline** — `app/changelog/page.tsx:11`, `app/tasks/page.tsx:28`, `app/compression/page.tsx:117`, `app/research/page.tsx:200` still hand-roll the same status palette. Dark variants added, but no shared `statusBadgeVariants` was extracted, so the ad-hoc pattern wasn't fully eliminated.

### Suggested follow-ups for a "rev C" pass

1. Migrate `app/research/[id]/page.tsx:133` and `app/research/research-actions.tsx:42` (clear missed primitives).
2. Loosen `EmptyState.description` to a `<div>` (cheap correctness fix).
3. Manually verify the `/chat` "+ New Chat..." launcher actually creates back-to-back sessions for the *same* agent (the one risk Codex flagged that I didn't reverify in dev).
4. Extract a `statusBadgeVariants` recipe (or expand `badgeVariants` with `tone`) so the tone maps in changelog/tasks/compression/research collapse to a single import.
5. Consider Tabs / segmented control for slack-panel channel tabs and search-dialog result rows.

None of these are regressions from the run — they're places the pass should have gone further. Recommend addressing them together as the next consistency pass rather than chasing them piecemeal here.

---

## Rev C — Codex follow-up commits (post-eyeball)

Edmund confirmed the `/chat` Combobox launcher works (back-to-back same-agent picks fire `onValueChange` correctly). Then asked for the rev C pass. Three new commits land on the same branch:

```
bb97201 ui(dashboard): extract statusTone recipe (rev C)
86e86c2 ui(dashboard): missed primitive migrations (rev C)
c9d2f07 ui(dashboard): combobox a11y, empty-state block content (rev C)
3e3d0b6 fix(llm): force gpt-4o-mini fallback ...                  ← also NOT FROM THIS RUN
```

(`3e3d0b6` is a second commit from the parallel cost-routing session, like `1cc3105` earlier — flagged for the same reason.)

### What rev C addressed (Codex findings → fix)

| Codex finding | Fix |
|---|---|
| Combobox missing `id`/`aria-labelledby` | Both props added; workspace Status/Risk now use `<label htmlFor>` + `id` instead of `aria-label` |
| `key={opt.value}` collides on duplicate sentinels | Now `key={value::index}` |
| EmptyState `description` in `<span>` | Swapped to `<div>` so block ReactNode is valid |
| `/chat` "+ New Chat..." launcher | **Verified working by Edmund** — no code change needed |
| `/research/[id]` ad-hoc `<span>` pills | Migrated to Badge variants |
| `research-actions.tsx` raw approve/dismiss buttons | Migrated to Button (icon-sm; ghost+emerald / destructive) |
| `search-dialog` result rows raw `<button>` | Migrated to ghost Button with multi-line layout overrides |
| `slack-panel` channel tabs raw `<button>` | Migrated to `<Tabs variant="line">` driven by `activeChannel` |
| `html-preview.tsx` Badge override | Switched to `variant="outline"` (no longer fights default bg/fg) |
| Tone maps duplicated inline | Extracted `lib/status-tone.ts` — single cva-backed `statusTone` recipe with 13 tones; 8 callsites migrated (changelog / tasks / compression / research / research/[id] / clients / inbox/promotions ×2) |

### Verification at end of rev C

- `npx tsc --noEmit` — clean
- `pnpm build` — success (only pre-existing next.config.ts NFT warning)
- All 14 top-level routes → 200

### Three places intentionally still inline (not Badge tones)

- `app/clients/workstream-tile.tsx` lines 211/324 — amber alert blocks use a 500/30 border, not the 500/20 Badge recipe; these are alert callouts, not Badges.
- Button hover-state overrides (`hover:bg-emerald-500/20` in research-actions / tasks / promotion-card) — those are Button color states, not Badge tones; statusTone covers Badges only.
- `app/chat/page.tsx:101` ToolCallPill amber-700 dark:amber-300 — running-tool decorative pulse with a stronger contrast than the standard tone.
