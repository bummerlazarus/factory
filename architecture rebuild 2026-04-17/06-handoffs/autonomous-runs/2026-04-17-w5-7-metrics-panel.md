# Run log — W5.7 dashboard metrics panel

**Date:** 2026-04-17
**Epic:** W5.7 — Dashboard metrics panel (cross-channel)
**Plan file:** [2026-04-17-w5-7-metrics-panel.md](../../05-design/plans/2026-04-17-w5-7-metrics-panel.md)
**Status:** 🟢 DONE

## Files touched

| File | Change |
|---|---|
| `dashboard/app/metrics/page.tsx` | **New** — Next.js server component at `/metrics`. Three sections: top-line cards, top-5 per platform, recent 20 snapshots. Reads `agent_youtube_videos`, `beehiiv_post_metrics`, `content_metrics`, `content_metrics_unified`. |
| `dashboard/supabase/migrations/20260417050000_content_metrics_unified_view.sql` | **New** — idempotent `CREATE OR REPLACE VIEW` unifying YouTube `content_metrics` rows with three unpivoted Beehiiv metrics (opens, clicks, web_views). |
| `dashboard/components/layout/sidebar.tsx` | Added `BarChart3` import + one nav entry `{ href: "/metrics", label: "Metrics", icon: BarChart3 }` between Promotions and Changelog. |
| `architecture rebuild 2026-04-17/05-design/plans/2026-04-17-w5-7-metrics-panel.md` | **New** — plan doc. |
| `architecture rebuild 2026-04-17/06-handoffs/backlog.md` | W5.7 ⚪ → 🟢. |

## Supabase migrations applied

One. Additive + idempotent (`CREATE OR REPLACE VIEW`). Applied via Supabase
MCP as migration `content_metrics_unified_view` on project
`obizmgugsqirmnjpirnh` (em-edmund-mitchell).

Post-apply probe: `SELECT count(*) FROM public.content_metrics_unified` →
**8** rows (all from the 8 existing YouTube `content_metrics` snapshots;
Beehiiv has 0 rows until first ingest).

## Page render test

```
$ curl -s -o /tmp/metrics.html -w 'HTTP %{http_code} | size %{size_download}\n' http://localhost:3000/metrics
HTTP 200 | size 68633
```

First 100 chars of body:

```
<!DOCTYPE html><html lang="en" class="plus_jakarta_sans_9261b771-module__9gMlNa__variable ibm_ple
```

No `nextjs-error-overlay` / `Unhandled Runtime Error` / `Failed to compile`
markers in the response body.

## Real data shown

Scraped from rendered HTML:

| Surface | Value |
|---|---|
| YouTube views (total) | **149,871** (sum across 362 `agent_youtube_videos` rows) |
| YouTube delta | null — "No prior-period snapshot" (expected: only today's 8 snapshots exist) |
| Beehiiv email opens | 0 |
| Beehiiv web views | 0 |
| Instagram | "disconnected — No access token. Ingest deferred (W5.4)." |
| Top YouTube video | 73,822 views (top 5 render: 73,822 / 13,783 / 8,121 / 3,224 / 2,971) |
| Top Beehiiv posts | empty state: "No Beehiiv posts yet. Run the `beehiiv-metrics` function to populate." |
| Recent snapshots | 8 rows, values 551 / 4 / 8 / 120 / 249 / 77 / 46 / 1,455 across `view_count`, `like_count`, `comment_count`, `favorite_count` |

## Sidebar

**Edited.** The `navItems` array in `components/layout/sidebar.tsx` was a
clear `{ href, label, icon }[]` — additive one-line insert is low-risk and
keeps parity with the existing /inbox and /inbox/promotions entries Edmund
added.

## Ordering choice (top 5 per platform)

By current lifetime metric (YouTube → `view_count`, Beehiiv →
`email_opens`). The recent-snapshots timeline already handles
"what-moved-recently"; the top-5 section answers "which asset is biggest
right now."

## Surprises

- **Beehiiv table has 0 rows in production.** The ingest function from W5.5
  is deployed but hasn't been triggered yet. The page handles this
  gracefully with empty-state copy rather than blank tables.
- **YouTube delta renders as null on day one.** There's only one run of
  snapshots in `content_metrics` (today's 8 rows). The delta calc requires
  a snapshot older than 30d. First computable delta will appear ~30 days
  after the second scheduled run lands. Worth scheduling the
  `youtube-metrics` function weekly so the first delta shows on 2026-05-17.
- `beehiiv_post_metrics` has **RLS disabled** while `content_metrics` has
  RLS enabled with an `auth.email()` policy. Not a bug here (we use the
  service-role key from `lib/supabase.ts`), but flagging: if this page
  ever moves to a public/anon client, the RLS asymmetry will bite.
