# Plan — W5.3 YouTube metrics ingest Edge Function

**Date:** 2026-04-17
**Epic:** W5.3 — YouTube metrics ingest (view / like / comment counts) into `content_metrics`
**Status:** 🟢 SHIPPED (see [run log](../../06-handoffs/autonomous-runs/2026-04-17-w5-3-youtube-metrics.md))

## Problem

Edmund publishes on multiple channels (YouTube Cordial Catholics + Edmund Mitchell, Instagram, Beehiiv, Circle). The dashboard needs cross-channel per-asset performance — which video keeps viewers best, which Reel drives replies, etc. — to power the "double-down" Skill (W5.8) and the metrics panel (W5.7).

`agent_youtube_videos` stores one row per video with `view_count / like_count / comment_count`, but updating those in place loses history. Without history we can't build trend charts or do "first-week velocity" analysis.

## Decision: option (c) — update canonical + append snapshot

Three options considered:

| Option | Pros | Cons |
|---|---|---|
| (a) Only update `agent_youtube_videos` | Simplest, no new table | No history — can't chart trends |
| (b) Only append to `content_metrics` | Full history | "Current count" queries need `ORDER BY fetched_at DESC LIMIT 1` everywhere |
| **(c) Both** ✅ | Simple current-count reads + full history for trend queries | Tiny amount of duplicated state; each call writes ~4 extra rows |

(c) is the right shape because `content_metrics` is the shared home for every publishing platform (YouTube, Instagram, Beehiiv, Circle) — W5.4+ all plug into the same table. `agent_youtube_videos` stays the YouTube-specific canonical row.

## Schema

New table `content_metrics`:

```sql
CREATE TABLE public.content_metrics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform     text NOT NULL,          -- 'youtube' | 'instagram' | 'beehiiv' | ...
  platform_id  text NOT NULL,          -- video_id / post_id / newsletter_id
  metric_name  text NOT NULL,          -- 'view_count' | 'like_count' | ...
  metric_value numeric,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb DEFAULT '{}'::jsonb
);
```

Indexes on `(platform, platform_id)`, `(fetched_at DESC)`, and `(platform, metric_name, fetched_at DESC)` for the two query shapes the dashboard needs (current value, trend line).

RLS: Edmund-only (matches other rebuild tables).

## Edge Function contract

`POST /functions/v1/youtube-metrics` with `x-capture-secret` header.

Three input modes:
1. `{ video_ids: [...] }` — poll exactly these (up to 200)
2. `{ channel_id: "UC..." }` — poll recent uploads of this channel
3. (empty body) — uses `YOUTUBE_CHANNEL_ID` env default

Channel-mode uses `playlistItems.list` against the uploads playlist (`UU` + channel suffix) in reverse-chronological order, capped by `limit` (default 20, cap 200) and optionally early-out on `since`.

Stats come from `videos.list?part=statistics,snippet` (batched 50 IDs per call).

Per video:
- **Upsert** `agent_youtube_videos` on `video_id`: refreshes `view_count / like_count / comment_count / title / channel_name / published_at / is_owned`.
- **Insert** one `content_metrics` row per metric (view / like / comment / favorite) with shared `fetched_at` timestamp and metadata `{ channel_id, channel_name, title, is_owned }`.

One failed video doesn't stop the batch — each result is tagged `ok|error` with a per-row error string.

## Scope limits (v1)

- **Public stats only.** YouTube Analytics API (watch time, retention, traffic sources, demographics) requires OAuth 2.0 + user consent and a separate endpoint. Tracked as W5.3b follow-up.
- **No historical backfill.** Each call captures `now()`. Trend charts accumulate as scheduled runs build up.

## Follow-ups (not this epic)

- **W5.3b — YouTube Analytics API (OAuth)** — watch time, retention graphs, traffic sources. Separate epic: requires OAuth consent flow and token refresh.
- **Scheduled task to drive periodic polls** — wire a Supabase/Claude scheduled task to hit this Edge Function hourly for fresh uploads + daily for the back-catalogue.
- **W5.7 dashboard metrics panel** — reads from `content_metrics`, charts trends.
