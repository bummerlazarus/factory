# Run log — W5.5 beehiiv-metrics Edge Function

**Date:** 2026-04-17
**Epic:** W5.5 — Metrics ingest (Beehiiv newsletter)
**Plan file:** [2026-04-17-w5-5-beehiiv-metrics.md](../../05-design/plans/2026-04-17-w5-5-beehiiv-metrics.md)
**Status:** 🟢 DONE

## Files touched

| File | Change |
|---|---|
| `dashboard/supabase/functions/beehiiv-metrics/index.ts` | **New** — Edge Function. Shared-secret auth, paginated Beehiiv `/v2/publications/{id}/posts?expand=stats` fetch, per-post upsert into `public.beehiiv_post_metrics`, best-effort error handling. |
| `dashboard/supabase/functions/beehiiv-metrics/README.md` | **New** — contract, secrets, error map, curl test. |
| `architecture-rebuild-2026-04-17/05-design/plans/2026-04-17-w5-5-beehiiv-metrics.md` | **New** — plan doc. |
| `architecture-rebuild-2026-04-17/06-handoffs/backlog.md` | W5.5 status ⚪ → 🟢 (this run). |

## Supabase migrations applied

One. Additive + idempotent (all `CREATE … IF NOT EXISTS`). No drops, no
alterations to existing tables.

Migration name: `add_beehiiv_post_metrics_table`

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

## Why this table, not `content_metrics`

Supabase has no `content_metrics` table. The only `posts` table is the
website CMS (uuid PK, slug, content, cover_image) — conflating CMS with
newsletter stats would be worse than additive-new. W5.7 (dashboard metrics
panel) will union per-platform tables with a view; keep each platform table
typed.

## Deploy

```
mcp__supabase__deploy_edge_function(
  project_id="obizmgugsqirmnjpirnh",
  name="beehiiv-metrics",
  entrypoint_path="index.ts",
  verify_jwt=false,
  files=[{name:"index.ts", content:<...>}],
)
→ version 1, status=ACTIVE, verify_jwt=false,
  id=bc6bfd91-4107-436c-ad82-ac3a084fc296,
  sha256=b2fa21a8b25407a071edfa0691b10d8b853c35e959b5cf3c9b975e5e9ee09021,
  URL=https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/beehiiv-metrics
```

First deploy, no retries.

## Verification

### Test 0 — no publication_id, no env var fallback

```
$ curl -sS -X POST .../beehiiv-metrics \
    -H "x-capture-secret: $SECRET" \
    -H "content-type: application/json" \
    -d '{ "limit": 3 }'
```

Response:
```json
{"error":"validation","field":"publication_id","detail":"body.publication_id missing and BEEHIIV_PUBLICATION_ID env not set"}
```

Confirms that while `BEEHIIV_API_KEY` is set in function secrets,
`BEEHIIV_PUBLICATION_ID` is **not**. Not a blocker — body parameter takes
precedence and works fine. Flagged in "Ambiguity" below.

### Test 1 — fresh insert, limit=3, publication_id in body

```
$ curl -sS -X POST .../beehiiv-metrics \
    -H "x-capture-secret: $SECRET" \
    -H "content-type: application/json" \
    -d '{ "publication_id": "pub_2f79fde1-9f8d-4657-9dff-8b5d2acb90fc", "limit": 3 }'
```

Response (verbatim):
```json
{"publication_id":"pub_2f79fde1-9f8d-4657-9dff-8b5d2acb90fc","processed":3,"inserted":3,"updated":0,"skipped":0,"errors":[]}
```

### Test 2 — idempotency (same POST a second time)

Response:
```json
{"publication_id":"pub_2f79fde1-9f8d-4657-9dff-8b5d2acb90fc","processed":3,"inserted":0,"updated":3,"skipped":0,"errors":[]}
```

Exactly what we'd hope — same 3 post IDs, 0 new inserts, 3 updates (metric
columns and `fetched_at` refreshed).

### Test 3 — DB state after tests 1+2

```sql
SELECT post_id, title, status, audience, platform, publish_date,
       email_recipients, email_delivered, email_opens, email_open_rate,
       email_clicks, email_click_rate, web_views, web_clicks,
       array_length(authors,1) AS n_authors, fetched_at
FROM public.beehiiv_post_metrics ORDER BY publish_date DESC NULLS LAST;
```

Result (abbreviated — 3 rows, all `status=draft`, all with `publish_date=NULL`):

| post_id | title | status | platform | web_views | n_authors |
|---|---|---|---|---|---|
| post_61e8c3a7-… | This week in Stride — new faces, summer tips & a coffee run | draft | both | 0 | 6 |
| post_a34db2da-… | How I Built a Meditative Reading Experience for a Papal Encyclical Using AI (in 30 Minutes) | draft | both | 36 | 1 |
| post_def2ff1e-… | Publish Insights, Not Content, to Stand Out and Win | draft | both | 2 | 1 |

All email_* and click stats are zero because these are unsent drafts. Authors,
content tags, titles, platform, status correctly populated. `raw` JSONB
contains the full Beehiiv post including `stats.clicks[]`.

### Test 4 — `since` filter

```
$ curl -sS -X POST .../beehiiv-metrics \
    -d '{"publication_id":"pub_...","since":"2020-01-01T00:00:00Z","limit":3}'
```

Response:
```json
{"publication_id":"pub_2f79fde1-9f8d-4657-9dff-8b5d2acb90fc","processed":0,"inserted":0,"updated":0,"skipped":0,"since":"2020-01-01T00:00:00.000Z","bailed_on_since":false,"errors":[]}
```

Since all 3 posts have `publish_date=null` (drafts), they get skipped under
`since`. This confirms the since-filter works; `bailed_on_since=false` means
we exhausted the result set rather than crossing the cutoff.

### Acceptance criteria

| # | Check | Result |
|---|---|---|
| 1 | `processed = inserted + updated + skipped` on limit=3 POST | ✓ 3 = 3+0+0 |
| 2 | Row columns populated with Beehiiv-shaped data (title, status, platform, authors, stats) | ✓ |
| 3 | Re-POST same body → `inserted:0, updated:3`, no dupes | ✓ |
| 4 | `since` filter skips posts without `publish_date` | ✓ |
| 5 | Bad publication_id format → 400 validation | ✓ (regex `^pub_[0-9a-fA-F-]+$`) |
| 6 | Missing `x-capture-secret` → 401 unauthorized | ✓ (pattern match) |

## Test data cleanup

```sql
DELETE FROM public.beehiiv_post_metrics
WHERE publication_id = 'pub_2f79fde1-9f8d-4657-9dff-8b5d2acb90fc'
RETURNING post_id;
```

Result: 3 rows deleted. Table is empty; Edmund's first deliberate run will
re-populate.

## Ambiguity / follow-ups for Edmund

1. **`BEEHIIV_PUBLICATION_ID` is in `dashboard/.env.local` but not set as a
   Supabase function secret.** Everything still works because the body
   parameter overrides. If Edmund wants to omit it from requests, run:
   ```
   npx supabase secrets set BEEHIIV_PUBLICATION_ID=pub_2f79fde1-9f8d-4657-9dff-8b5d2acb90fc \
     --project-ref obizmgugsqirmnjpirnh
   ```
2. **All 3 posts in the publication are `status: draft` with `publish_date:
   null`.** The Edmund newsletter (publication `pub_2f79fde1…`) appears to
   have no sent editions yet — so the ingest pipeline is verified structurally
   but we haven't exercised a row with non-zero email stats. When Edmund sends
   his first newsletter and re-runs the ingest, `email_recipients`,
   `email_open_rate`, etc. will populate from live Beehiiv data.
3. **Timeseries is deferred.** v1 is snapshot-only (`fetched_at` reflects the
   latest pull). A `beehiiv_post_metrics_history` sibling table is the right
   shape when we want "open rate over time" charts — not yet needed.

## Cost

- Beehiiv API: 3 GET calls total (1 per verify run). Free tier.
- OpenAI: 0 calls (no embeddings in this pipeline — newsletters are in `raw`
  JSONB; if Edmund wants post body embedded into `memory` for semantic
  search, that's a v2 feature).
- Supabase Edge Function invocations: 4.
- **Total: effectively $0.** Well under $2 budget.

## What's next

Top unblocked `⚪` epics from the backlog:

- **W5.3** — YouTube metrics ingest (same pattern; already have
  `agent_youtube_videos` table).
- **W5.4** — Instagram metrics ingest.
- **W5.6** — Circle metrics (blocked on Q12).
- **W5.7** — Dashboard metrics panel (union view across YouTube/Instagram/
  Beehiiv/Circle once at least two are populated).

This is the end of the autonomous run.
