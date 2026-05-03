# Plan — W5.5 Beehiiv metrics ingest Edge Function

**Date:** 2026-04-17
**Epic:** W5.5 — Beehiiv newsletter metrics ingest
**Status:** 🟢 shipped (see run log 2026-04-17-w5-5-beehiiv-metrics.md)

## What this ships

A Supabase Edge Function (`beehiiv-metrics`) that pulls posts + per-post stats
from Beehiiv's v2 API and upserts them into `public.beehiiv_post_metrics` (one
row per `(publication_id, post_id)`). Follows the `capture()` /
`youtube-ingest` / `signals-ingest` patterns: `verify_jwt=false`,
shared-secret `x-capture-secret` header, best-effort writes, structured JSON
response with a per-post `errors[]` array.

## Why additive schema instead of `content_metrics`

There is **no existing `content_metrics` table**. The only `posts` table in
this Supabase project is the website CMS (`public.posts` — uuid PK, content,
slug, cover_image, lead_magnet_id). Wiring Beehiiv metrics into that would
conflate the CMS record of a blog post with a newsletter stats row for a
separate post on a separate system; no upside, lots of coupling.

The backlog (Wave 5) lists metrics ingests for YouTube (W5.3), Instagram
(W5.4), Beehiiv (W5.5), Circle (W5.6) → all feed a "dashboard metrics panel"
(W5.7). The right move for W5.7 is a thin `content_metrics` view union-ing the
per-platform tables, not a single god-table. Each platform has a different
native shape; forcing them into a generic `(channel, platform_id, metric_name,
metric_value)` EAV loses the schema type-safety and makes dashboards slower.

So v1 = `beehiiv_post_metrics`, dedicated, normalized-enough, plus a `raw`
JSONB for anything Beehiiv adds later.

## Schema applied (additive, idempotent — migration `add_beehiiv_post_metrics_table`)

```sql
CREATE TABLE IF NOT EXISTS public.beehiiv_post_metrics (
  publication_id  text NOT NULL,
  post_id         text NOT NULL,
  title           text,
  subtitle        text,
  web_url         text,
  status          text,
  audience        text,
  platform        text,
  subject_line    text,
  preview_text    text,
  publish_date    timestamptz,
  displayed_date  timestamptz,
  created         timestamptz,
  content_tags    text[],
  authors         text[],
  -- Email stats (from Beehiiv expand=stats)
  email_recipients       integer,
  email_delivered        integer,
  email_opens            integer,
  email_unique_opens     integer,
  email_open_rate        numeric,
  email_clicks           integer,
  email_unique_clicks    integer,
  email_verified_clicks  integer,
  email_click_rate       numeric,
  email_unsubscribes     integer,
  email_spam_reports     integer,
  -- Web stats
  web_views   integer,
  web_clicks  integer,
  raw         jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (publication_id, post_id)
);

CREATE INDEX IF NOT EXISTS beehiiv_post_metrics_publish_date_idx
  ON public.beehiiv_post_metrics (publish_date DESC);
CREATE INDEX IF NOT EXISTS beehiiv_post_metrics_fetched_at_idx
  ON public.beehiiv_post_metrics (fetched_at DESC);
```

All `CREATE … IF NOT EXISTS`. No destructive changes to any existing table.

## API contract

`POST /functions/v1/beehiiv-metrics`

Header: `x-capture-secret: $CAPTURE_SECRET`.

Body (all optional):

```json
{ "publication_id": "pub_...", "since": "2026-01-01T00:00:00Z", "limit": 50 }
```

- `publication_id` falls back to `BEEHIIV_PUBLICATION_ID` env var.
- `since` is a client-side filter — Beehiiv's list endpoint has no native
  since-filter. Ordered by `publish_date desc`, pagination stops when the
  cutoff is crossed.
- `limit` — default 50, hard max 500. Beehiiv paginates at 100/page.

Response:

```json
{
  "publication_id": "pub_...",
  "processed": 3,
  "inserted": 3,
  "updated": 0,
  "skipped": 0,
  "errors": []
}
```

Per-post errors (upsert failures, validation misses) surface in `errors[]`
with `{ post_id?, stage, message }`. Beehiiv fetch failures surface with
`stage: "list_posts"`.

## Decisions this run

1. **Dedicated `beehiiv_post_metrics` table** over generic `content_metrics` —
   see "Why additive schema" above.
2. **Snapshot semantics, not timeseries.** One row per post; re-runs refresh
   columns. Timeseries is a separate, future concern if Edmund wants "open
   rate over time" charts — introduce `beehiiv_post_metrics_history` then.
3. **`raw` JSONB column** preserves the full Beehiiv post body (including
   per-URL click stats in `stats.clicks[]`) so we don't have to migrate every
   time Beehiiv adds a field or we want to surface something new.
4. **`expand=stats` on every list call.** No second round-trip to the
   per-post endpoint — Beehiiv ships stats inline when expanded.
5. **Existing-row detection via a targeted SELECT before upsert.** Lets us
   return accurate `inserted` vs `updated` counts without `ON CONFLICT … DO
   UPDATE SET … RETURNING xmax` gymnastics. Best-effort; on SELECT failure we
   still upsert.

## What's deferred

- **URL-level click breakout.** `stats.clicks[]` is stored in `raw` JSONB only.
  If Edmund wants a `beehiiv_post_url_clicks` table keyed by `(post_id, url)`,
  that's a follow-up.
- **Publication-level stats.** `GET /v2/publications/{id}/stats` (subscriber
  deltas over time) is not called in v1. Add a `beehiiv_publication_metrics`
  table if Edmund wants the subscriber growth curve.
- **Scheduled trigger.** No cron wired in. Edmund can invoke manually, from a
  dashboard button (W5.7), or add `pg_cron` / Supabase Scheduled Functions
  later.
- **Historical timeseries.** v1 is snapshot-only. Add a sibling
  `beehiiv_post_metrics_history` table with `(publication_id, post_id,
  fetched_at)` PK if/when needed.
- **Rate-limit handling.** Beehiiv doesn't publish strict rate limits; a
  single run fetches at most 5 pages (limit=500, perPage=100). If Edmund hits
  429s we'll add backoff.

## Verification

See run log `06-handoffs/autonomous-runs/2026-04-17-w5-5-beehiiv-metrics.md`
for the actual curl + JSON responses. Summary:
- First POST (limit=3) → `inserted: 3, updated: 0`.
- Second POST same body → `inserted: 0, updated: 3` (idempotent).
- `since=2020-01-01` POST → `processed: 0, bailed_on_since: false` → confirms
  `since` logic works (publication has only drafts with `publish_date=null`).
- DB state inspected; test rows cleaned up after verify.
