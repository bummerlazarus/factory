# W5.8 — "Double-down" Skill — Run log

**Date:** 2026-04-17
**Status:** 🟢 Shipped
**Migration:** `20260417080000_double_down_skill.sql` (applied)
**Project:** Supabase `obizmgugsqirmnjpirnh`

## Recon

| Check | Result |
|---|---|
| `promotions` table exists? | No. `/inbox/promotions` reads `skill_versions` (Corva retros), not content promotions. Different noun. |
| `reference_docs.kind` CHECK current values | `goal,value,kpi,framework,claude_md,principle,persona,playbook,doc,cluster` |
| `content_metrics` (YouTube) | 2 distinct videos × 4 metrics each = 8 rows; only 2 rows have `metric_name='view_count'` |
| `beehiiv_post_metrics` | 0 rows (empty table) |
| `agent_youtube_videos` | 362 rows (but distinct from content_metrics) |
| Existing cron jobs | `librarian-daily` (06:00 UTC) |

**Destination chosen:** `reference_docs` with `kind='promotion'` (fallback path per spec).
Reason: no dedicated promotions table; the dashboard's promotions surface is currently for skill_versions.

## Migration applied

Added `'promotion'` to `reference_docs_kind_check`, created
`public.double_down_scan(lookback_days int, top_n int) RETURNS jsonb`,
scheduled `double-down-nightly` at `0 8 * * *` UTC.

Lines: 250 (comments-heavy), net SQL ~170 — under the 300 cap.

## Verify — live run

```
SELECT public.double_down_scan(30, 3);
```

```json
{
  "top_n": 3,
  "proposed": 2,
  "processed": 2,
  "window_end": "2026-04-17T21:53:10.20809+00:00",
  "window_start": "2026-03-18T21:53:10.20809+00:00",
  "lookback_days": 30,
  "promotion_ids": [
    "cb424ace-28f0-4c80-8eca-ed279b5e14ea",
    "1a553d8c-2799-4a25-a0cd-6c6d76eb2323"
  ],
  "skipped_existing": 0
}
```

Note: `processed=2` (not 3) because only 2 YouTube videos have
`view_count` metrics in `content_metrics` today. Beehiiv table is empty. So
2 is the real cap.

## Verify — idempotency re-run

```
SELECT public.double_down_scan(30, 3);  -- same day, same inputs
```

```json
{
  "top_n": 3,
  "proposed": 0,
  "processed": 2,
  "window_end": "2026-04-17T21:53:16.357738+00:00",
  "window_start": "2026-03-18T21:53:16.357738+00:00",
  "lookback_days": 30,
  "promotion_ids": [],
  "skipped_existing": 2
}
```

`skipped_existing=2`, `proposed=0`. Idempotency confirmed.

## Verify — destination rows

```
SELECT slug, title, metadata->>'source', metadata->>'platform',
       metadata->>'metric_value', metadata->>'dedup_key'
FROM reference_docs WHERE kind='promotion';
```

| slug | title | source | platform | metric_value | dedup_key |
|---|---|---|---|---|---|
| promotion-2026-04-17-youtube-jZQ4NOASrqI | Double down: How to save time in catholic ministry | double_down | youtube | 551 | 2026-04-17\|youtube\|jZQ4NOASrqI |
| promotion-2026-04-17-youtube-Y6WEKXwaYdg | Double down: Grow as a catholic minister with the 3-4-5 zealous framework | double_down | youtube | 47 | 2026-04-17\|youtube\|Y6WEKXwaYdg |

Count matches what the function reported.

## Cleanup

```
DELETE FROM reference_docs WHERE kind='promotion' AND metadata->>'source'='double_down';
-- returned 2 rows
SELECT count(*) FROM reference_docs WHERE kind='promotion';
-- returned 0
```

Confirmed clean.

## Cron job

```
jobname              schedule   command                                      active
double-down-nightly  0 8 * * *  SELECT public.double_down_scan(7, 5);        true
```

## Follow-ups

1. Split promotions out of `reference_docs` into a dedicated ephemeral table when the dashboard grows a content-promotions inbox.
2. Extend to Instagram (W5.4) + Circle (W5.6) when those metrics land.
3. Shift to delta-based "over-indexing" signal once `content_metrics` has more snapshots per piece.
4. W5.9 "Educated bets" Skill is now unblocked.
