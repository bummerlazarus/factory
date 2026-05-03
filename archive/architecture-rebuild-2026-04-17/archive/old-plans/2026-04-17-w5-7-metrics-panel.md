# Plan — W5.7 Dashboard metrics panel

**Date:** 2026-04-17
**Epic:** W5.7 — Cross-channel metrics dashboard page
**Status:** 🟢 shipped (see run log 2026-04-17-w5-7-metrics-panel.md)

## What this ships

A new route at `/metrics` on the dashboard (Next.js server component). Reads
three Supabase sources and renders three sections:

1. **Top-line cards (last 30 days)** — YouTube total views, Beehiiv email
   opens, Beehiiv web views. Each card shows a delta vs the prior 30-day
   window when computable; shows "No prior-period data" otherwise.
   Instagram is an explicit "disconnected" card — W5.4 abandoned for lack of
   an access token.
2. **Top 5 per platform** — two small tables (YouTube + Beehiiv). Ordering
   choice: current lifetime metric (YouTube → `view_count`, Beehiiv →
   `email_opens`). Rationale below.
3. **Recent 20 snapshots** — timeline from the new
   `content_metrics_unified` view, joined against
   `agent_youtube_videos` / `beehiiv_post_metrics` for title lookup.

No home-page edit. No client-side fetching. No external API calls from the
page — only Postgres reads.

## Ordering choice for "top 5"

Two sensible choices:

- **Most recent activity** — order by `max(fetched_at)` of the platform's
  snapshots. Surfaces what moved most recently.
- **Total current metric** — order by the canonical "how big is this
  asset" number.

Chose **current metric**. Rationale: the *recent-snapshots* section already
does the "what moved recently" job. The *top 5* section should answer
"which of my assets is the biggest right now" — a flatter evergreen view
that doesn't churn every time a new snapshot appends. If Edmund wants
"biggest recent mover" later, we add a third section; we don't overload
this one.

## Unified view — why a DB view, not in-page joins

Two per-platform shapes (YouTube EAV in `content_metrics`; Beehiiv typed
columns in `beehiiv_post_metrics`). Two options:

1. Page does two queries + union in TypeScript.
2. A `content_metrics_unified` view does the union in Postgres; page reads
   one table.

Chose #2. Reasons:
- When W5.6 (Circle) or a future platform lands, updating the view is one
  migration; the page doesn't change.
- Sorts/limits happen in Postgres, which has indexes on `fetched_at`.
- Matches the spec's "schema drift tolerated at the view layer, not the
  page" direction.

Migration file: `dashboard/supabase/migrations/20260417050000_content_metrics_unified_view.sql`.
Applied via Supabase MCP as migration `content_metrics_unified_view`.

Shape:

```
platform     text          -- 'youtube' | 'beehiiv'
platform_id  text          -- video_id or post_id
metric_name  text          -- 'view_count', 'like_count', 'email_opens', ...
metric_value numeric
fetched_at   timestamptz
metadata     jsonb         -- {title, web_url, publication_id, status, ...}
```

For YouTube: passthrough of `content_metrics WHERE platform='youtube'`. For
Beehiiv: three `UNION ALL` branches that unpivot `email_opens`,
`email_clicks`, and `web_views` into one row each.

## Top-line deltas — honest about source

- **YouTube current total**: SUM of current `view_count` across all rows in
  `agent_youtube_videos` (362 rows at time of ship).
- **YouTube delta**: best-effort. Picks the latest pre-30d snapshot per
  `platform_id` from `content_metrics` (metric_name='view_count') and sums.
  If that lookup returns zero rows, delta is rendered as "No prior-period
  snapshot" instead of a misleading "+149,871" (everything vs nothing).
  This means: at ship time (snapshots only exist for Q1 of 2026-04-17),
  the delta will correctly display as null until the next month's run.
- **Beehiiv**: sums directly from `beehiiv_post_metrics` typed columns. No
  historical table yet (Beehiiv has its own snapshot-replacing upsert
  pattern, not an append-only log), so delta uses `publish_date < cutoff`
  as a proxy. Null when zero posts in the table (current state — Beehiiv
  ingest hasn't run yet in production).

## Constraints honored

- Touched none of: `app/page.tsx`, `app/inbox/`, `app/api/promotions/`,
  `lib/supabase-browser.ts`.
- **Did** touch `components/layout/sidebar.tsx` — one-line nav-array
  addition plus one icon import. The structure was a plain
  `{ href, label, icon }[]` array, and the /inbox link was already there
  in Edmund's uncommitted changes, so adding one more entry is strictly
  additive. Easy to revert if it clashes.
- Server component. No client data fetching. No external APIs.
- Net added: 1 new page (~380 lines), 1 migration (~75 lines), 2-line
  sidebar change. Under 500 net.

## Files

| File | Change |
|---|---|
| `dashboard/app/metrics/page.tsx` | **New.** Server component, three sections. |
| `dashboard/supabase/migrations/20260417050000_content_metrics_unified_view.sql` | **New.** Idempotent `CREATE OR REPLACE VIEW`. |
| `dashboard/components/layout/sidebar.tsx` | Added `BarChart3` import + one nav entry for `/metrics` between Promotions and Changelog. |
| `architecture-rebuild-2026-04-17/06-handoffs/backlog.md` | W5.7 ⚪ → 🟢. |

## Verify (done)

1. Supabase apply_migration: `content_metrics_unified_view` succeeded.
2. `SELECT count(*) FROM public.content_metrics_unified` → **8** (the 8
   YouTube snapshots from W5.3; 0 Beehiiv rows since ingest hasn't run).
3. `curl -s http://localhost:3000/metrics` → **HTTP 200**, 68KB body.
4. Rendered numbers scraped from HTML: YouTube total **149,871**, Beehiiv
   opens **0**, Beehiiv views **0**, top-YouTube-video **73,822 views**,
   timeline **8 rows**.
5. No Next.js error overlay strings in response body.

## Follow-ups (not in this ship)

- Delta for YouTube requires a pre-30d snapshot. Schedule the
  `youtube-metrics` function to append at least weekly so deltas start
  computing.
- Beehiiv ingest is deployed but has zero rows in prod. First run will
  populate the empty tiles.
- Instagram tile will stay "disconnected" until W5.4 is unblocked
  (access token).
- Circle (W5.6) plugs into the view with one more `UNION ALL` once that
  ingest lands.
