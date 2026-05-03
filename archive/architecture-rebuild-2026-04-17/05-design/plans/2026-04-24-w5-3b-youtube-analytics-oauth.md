# Plan — W5.3b YouTube Analytics API (OAuth)

**Date:** 2026-04-24
**Epic:** W5.3b — watch time, retention, traffic sources, demographics
**Depends on:** W5.3 (shipped) — reuses `content_metrics` table
**Status:** 🟡 PLANNED — needs Edmund's Google Cloud OAuth consent step

## Why this exists

W5.3 polls the public YouTube **Data API v3** — public counts only (views, likes,
comments). The metrics that actually drive content decisions live behind the
**YouTube Analytics API**, which requires OAuth consent by the channel owner:

- Watch time (minutes)
- Average view duration
- Average percentage viewed (retention)
- Traffic sources (search / suggested / browse / external)
- Impressions + CTR
- Subscribers gained/lost per video
- Audience demographics (age/gender/geo)

## Shape

Same table as W5.3. New `metric_name` values in `content_metrics`:

| metric_name | Unit | Notes |
|---|---|---|
| `watch_time_minutes` | minutes | per video per fetch |
| `avg_view_duration_seconds` | seconds | |
| `avg_view_percentage` | percent (0-100) | |
| `impressions` | int | |
| `ctr` | percent | |
| `subscribers_gained` | int | delta over window |
| `subscribers_lost` | int | delta over window |

Channel-level metrics (not per-video) land with `platform_id = 'channel:<channel_id>'`.

## Work

### 1. OAuth setup (Edmund's hands)
- [ ] Create OAuth 2.0 Client ID in Google Cloud Console (Web application)
- [ ] Add authorized redirect URI: `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/youtube-oauth-callback`
- [ ] Add scope: `https://www.googleapis.com/auth/yt-analytics.readonly`
- [ ] Enable "YouTube Analytics API" on the project
- [ ] Add test user: edmund.j.mitchell@gmail.com (while app is in "testing" mode)
- [ ] Store `YOUTUBE_OAUTH_CLIENT_ID` + `YOUTUBE_OAUTH_CLIENT_SECRET` in Supabase vault

### 2. Token storage migration
- [ ] New table `youtube_oauth_tokens` (channel_id, access_token, refresh_token, expires_at). RLS Edmund-only.

### 3. Edge Functions
- [ ] `youtube-oauth-start` — builds consent URL, redirects Edmund to Google
- [ ] `youtube-oauth-callback` — exchanges code for refresh token, stores in table
- [ ] `youtube-analytics` — reads token, calls Analytics API, writes to `content_metrics`
  - Handles refresh token rotation
  - Batches video_ids (Analytics API is more restrictive than Data API)
  - Handles 90-day data lag (some metrics take 48h to populate)

### 4. Cron
- [ ] Daily at 6:15 UTC (15min after `youtube-metrics-daily`) — `youtube-analytics-daily`

### 5. Consent flow
- [ ] Edmund opens `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/youtube-oauth-start`
- [ ] Approves in Google consent screen
- [ ] Callback stores refresh token → `youtube-analytics` now works

## Open questions

- Analytics API has a 90-day historical limit for some metrics. Backfill only covers the last 90 days of watch time, not lifetime.
- Audience demographics have a minimum-view threshold — small videos return no data.
- Shorts metrics: YouTube exposes some Shorts-specific metrics (like "viewed to the end %") — confirm scope before implementing.

## Out of scope

- Competitor analytics (Google doesn't allow cross-channel Analytics access)
- Real-time (the Analytics API has ~48h lag)
- Revenue metrics (needs YouTube Partner Program + separate scope)
