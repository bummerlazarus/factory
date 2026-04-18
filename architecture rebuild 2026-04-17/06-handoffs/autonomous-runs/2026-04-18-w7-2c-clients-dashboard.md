# W7.2c — `/clients` dashboard surface

**Date:** 2026-04-18
**Epic:** W7.2c (depends on W7.2a+b — workstreams table + FK already shipped).
**Status:** 🟢 DONE
**Project ref:** `obizmgugsqirmnjpirnh`.

## Scope

New route `/clients` (server component) renders one tile per active row in
`public.workstreams`. Each tile pulls from three tables:

- `public.workstreams` — title, kind, status, slug
- `public.reference_docs` (kind=`client-scope`, slug=`scope-<ws>`) — scope body + `needs_enrichment` flag
- `public.work_log` — last 5 captures for that slug, total capture count, most-recent `created_at` for drift
- `public.agent_tasks` — open-tasks count (status NOT IN done/rejected/completed/approved)

The `dc-clients` umbrella tile additionally renders 3 sub-client mini-cards
(cfcs, liv-harrison, culture-project) — each with its own scope doc preview
and `artifacts->>'client'`-filtered captures. Lisa is NOT a tile (per
2026-04-18 resolution — she's a Culture Project sub-contact).

## Files

| Path | Change |
|---|---|
| `dashboard/app/clients/page.tsx` | **new** — server component; 4 parallel fetchers, tile composition, canonical sort order. |
| `dashboard/app/clients/workstream-tile.tsx` | **new** — client component (uses `MarkdownRender`); tile + sub-client mini-card UI. Kind/status/sub-client badge palettes, drift ramp (green ≤7d / amber 8–14d / red >14d or null). |
| `dashboard/components/layout/sidebar.tsx` | appended one nav entry: `{ href: "/clients", label: "Clients", icon: Briefcase }` between Research and Changelog. Import updated. No other edits. |
| `dashboard/lib/icons.ts` | added `Briefcase` to the lucide-react import and re-export list. Nothing else touched. |

## Styling

- `Card` / `CardHeader` / `CardTitle` / `CardContent` from `components/ui/card`.
- `Badge` from `components/ui/badge` for kind and status.
- Kind palette: `dc-client-umbrella`=violet, `internal-venture`=sky, `personal-brand`=pink, `internal-infra`=neutral/muted. (Plan said purple/blue/pink/neutral — violet/sky/pink/muted is the closest Tailwind semantic match that matches other pages' palette convention.)
- Status: active=emerald, paused=amber, else muted.
- Sub-client palette: cfcs=blue, liv-harrison=fuchsia, culture-project=orange.
- Drift label: "N days quiet" / "touched today" / "no captures yet".
- Empty state for each tile: "No captures yet for this workstream." in muted italic.
- Scope preview rendered via existing `MarkdownRender` component (same react-markdown stack used elsewhere in the app), truncated to ~300 chars for workstreams / ~220 for sub-clients.

## Verification (preview serverId `fb2a6095-e272-4348-acdc-7e7ac1a0abf6`)

1. **HTTP + render:** `GET /clients → 200`. `document.querySelectorAll('[data-slot="card"]').length === 6`. `<h1>Clients` present, subtitle reads "Active workstreams. Scope docs, recent captures, open tasks, and drift signal per project." Header badge reads "6 active".
2. **Factory tile:** renders `internal-infra` + `active` badges, `touched today` drift label (factory has 8 work_log rows, most recent 2026-04-18). Shows "RECENT CAPTURES (5)" list.
3. **DC clients tile:** renders `dc-client-umbrella` + `active` badges, "no captures yet" drift, 0 open tasks + 0 total captures pill. "SUB-CLIENTS (3)" section with CFCS, Liv Harrison, Culture Project mini-cards — each showing the yellow "needs Edmund's content" banner because all three DC sub-client scope docs have `metadata.needs_enrichment=true`.
4. **ZPM / Real+True / Faith & AI / em-brand tiles:** all present, all "no captures yet", all showing "needs Edmund's content" banner except `em-brand` which has a filled-in scope doc.
5. **Drift indicator:** factory renders green "touched today"; all other 5 render red "no captures yet" — ramp is visible.
6. **Sidebar:** navigation snapshot shows Home → Agents → Chat → Files → Workspace → Agent Tasks → Inbox → Promotions → Metrics → Research → **Clients** → Changelog (correct insertion point).
7. **Screenshot:** taken mid-scroll showing sidebar highlight on Clients and the top of the Factory tile with all badges + drift + scope rendered. (Returned inline via `preview_screenshot`; not persisted to disk — attach from transcript if needed.)

## Console logs

`preview_console_logs level=error lines=50` returned a buffered historical error referencing a merge-conflict marker (`>>>>>>> Stashed changes`) at `sidebar.tsx:40`. The **current** file has no such marker (verified via Read at lines 28–42 — clean), and the page renders/hydrates without parse failure. These entries are stale buffer contents from a prior bad state of the file before this run; recent `preview_logs` of the Next build shows clean `GET /clients 200` responses (1247ms, 1300ms) with no current parse errors. No new errors attributable to this change.

## Data observations

Query snapshot at time of build (from Supabase project `obizmgugsqirmnjpirnh`):

- `workstreams WHERE status='active'` → 6 rows: factory, dc-clients, em-brand, faith-ai, real-true, zpm. ✅
- `reference_docs WHERE kind='client-scope'` → 9 rows (6 workstream scopes + 3 DC sub-client scopes). ✅
- `work_log` → 8 rows with `project='factory'` (latest 2026-04-18 04:20 UTC — hence "touched today"); no other workstream has captures yet. Several `project IS NULL` rows exist — those are correctly excluded from tiles.
- `agent_tasks` → 1 row total, `project_slug IS NULL`, `status='approved'`. 0 open tasks for every workstream.

## Do-NOT checks (all honored)

- [x] No RLS policy changes on `workstreams` or any other table.
- [x] Did not touch portfolio `public.projects` table.
- [x] Did not seed new workstreams or scope docs.
- [x] Lisa is not a tile — she appears only as a Culture Project sub-contact comment in the UI/data layer.
- [x] Sidebar: one append, no other edits. Verified by reading the file end-to-end.
- [x] Placeholder scope doc bodies rendered as-is with the yellow "needs enrichment" banner.

## Follow-ups

1. **DC sub-client scope enrichment** — still the single biggest gap. All three DC sub-client scope docs, plus zpm / real-true / faith-ai, are placeholder "TBD" bodies. Kardia's drift checks and the UI's "needs Edmund's content" banner are both pointing at this. Until Edmund fills in retainer / contact / deliverables, Kardia has nothing concrete to steer against. Biggest ROI: start with the three DC sub-clients (CFCS, Liv Harrison, Culture Project) since those have real retainer obligations.
2. **Sub-client tab UI** — currently the 3 DC sub-client mini-cards stack vertically inside the umbrella tile. If the list ever grows past 3 (unlikely per the tightened enum), consider swapping to a `Tabs` primitive from `components/ui/tabs`.
3. **Open-task counts** — all 0 today. Once Kardia/other agents start emitting tasks with `project_slug` set, the pill becomes live without further dashboard work.
4. **Drift staleness** — the `days_since_last_touch` is computed at render time from `work_log.created_at`. Because the page is `dynamic = "force-dynamic"`, it re-queries on every request. No cache-invalidation concern.

## Data contract assumptions (worth locking in)

- `workstreams.kind` ∈ {`dc-client-umbrella`, `internal-venture`, `personal-brand`, `internal-infra`} — the tile color palette assumes this enum. Adding a kind requires updating `kindBadgeClass` in `workstream-tile.tsx`.
- Scope slug convention: `scope-<workstream.slug>` for workstreams, `scope-dc-clients-<sub>` for DC sub-clients. Page hard-codes the sub-client list `[cfcs, liv-harrison, culture-project]` — if sub-clients change, update `DC_SUB_CLIENTS` in `page.tsx`.
- Sub-client tagging: `work_log.artifacts->>'client'` is the ONLY mechanism surfaced. A capture with `project='dc-clients'` and no `artifacts.client` appears in the umbrella tile's "Recent captures" list with an empty sub-client badge.
