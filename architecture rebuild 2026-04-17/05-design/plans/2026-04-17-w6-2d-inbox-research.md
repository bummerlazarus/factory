# W6.2d — /research dashboard surface

**Date:** 2026-04-17
**Status:** Shipping.
**Depends on:** W6.2a (theme rows) shipped; W6.2b (connection rows) shipping concurrently.

---

## 1. Scope

First user-visible surface for the research-director output. Lists `reference_docs` rows of kind `theme` or `connection`, shows source-breakdown badges, and lets Edmund triage with Approve / Dismiss buttons that write `metadata.approved_at` / `metadata.dismissed_at`.

## 2. Route decision

**Chosen: `/research`** (standalone, sibling to `/metrics`).

Rationale:
- Shorter, cleaner URL.
- Consistent with `/metrics` (also a cross-corpus read-only analytical surface).
- `/inbox/` is currently Edmund's active/uncommitted territory — hands off.
- The spec explicitly allows picking either path; recommendation matches spec's preferred.

Sidebar label: **"Research"**. Icon: `Search` (lucide).

## 3. Deliverables

- `dashboard/app/research/page.tsx` — server component, filter row, list, empty state
- `dashboard/app/research/research-actions.tsx` — client island for Approve/Dismiss buttons
- `dashboard/app/api/research/decide/route.ts` — POST handler writing `metadata.approved_at|dismissed_at`
- Plan doc: this file
- Run log: `06-handoffs/autonomous-runs/2026-04-17-w6-2d-inbox-research.md`

## 4. Page shape

### Header
- Title: "Research"
- One-line description: "Emergent themes and cross-silo connections from your corpus."

### Filter row
Three query-param pills: **All** / **Themes** / **Connections** via `?kind=theme|connection` (default = all).

### List
Most recent 30 rows where:
- `kind IN ('theme','connection')`
- `metadata->>'dismissed_at' IS NULL`
- `metadata->>'approved_at' IS NULL` (out of default view; approved rows are "handled")

Per row:
- Title + 2-line body snippet
- Kind badge (theme/connection) + size badge (cluster_size for themes; similarity % for connections)
- Source-breakdown badges: 4 visible + "+ N more"
  - Themes: distinct `member_sources` entries
  - Connections: `a_source` + `b_source`
- Approve / Dismiss buttons (client island)
- `created_at` relative time

### Empty state
"Clusters appear when data piles up. Check back after Monday 7am UTC when the weekly scan runs."

## 5. API route

`POST /api/research/decide`
- Body: `{ id: uuid, action: "approve" | "dismiss" }`
- Server-side: fetches existing metadata, merges `approved_at` / `dismissed_at` = `now().toISOString()`, writes back via supabase `update`.
- Uses `jsonb_set` semantics (merge-in-JS since supabase-js doesn't expose jsonb_set directly — we read-modify-write under service role).
- Response: `{ ok: true }` or `{ error: string }`.

## 6. Sidebar

Do NOT modify `components/layout/sidebar.tsx` directly (Edmund has uncommitted edits). The sidebar uses a static `navItems` array — no registry pattern exists. The run log flags a 1-line manual addition for Edmund:

```ts
{ href: "/research", label: "Research", icon: Search },
```

to be placed between `Metrics` and `Changelog`.

## 7. Constraints respected

- Under 500 net lines
- No new npm deps
- Server components + one minimal client island for buttons
- Don't touch `app/inbox/`, `app/api/promotions/`, `components/layout/sidebar.tsx`, `lib/supabase-browser.ts`, `app/page.tsx`, any `app/api/files*`

## 8. Verification plan

1. `curl -I http://localhost:3000/research` → 200
2. Seed 2 rows (1 theme, 1 connection — temporarily extend CHECK constraint, revert after), confirm both render
3. `GET /research?kind=theme` hides connection row; `GET /research?kind=connection` hides theme row
4. `POST /api/research/decide` with `approve` → row's `metadata.approved_at` populated, row disappears from default view
5. `POST /api/research/decide` with `dismiss` → `metadata.dismissed_at` populated, row disappears
6. Empty-state copy renders when filter has zero matches
7. Cleanup seeded rows + revert CHECK constraint
