# Run log — W5.3 YouTube metrics ingest Edge Function

**Date:** 2026-04-17 (evening)
**Epic:** W5.3 — metrics ingest (YouTube) into `content_metrics` + refresh `agent_youtube_videos`
**Plan:** [2026-04-17-w5-3-youtube-metrics.md](../../05-design/plans/2026-04-17-w5-3-youtube-metrics.md)
**Status:** 🟢 DONE

## Files written

| File | Purpose |
|---|---|
| `dashboard/supabase/migrations/20260417030000_content_metrics.sql` | New shared metrics table — idempotent, RLS (Edmund-only) |
| `dashboard/supabase/functions/youtube-metrics/index.ts` | The Edge Function — polls YouTube Data API v3, dual-writes |
| `dashboard/supabase/functions/youtube-metrics/README.md` | Contract, secrets, error codes, scheduling notes |
| `architecture-rebuild-2026-04-17/05-design/plans/2026-04-17-w5-3-youtube-metrics.md` | Plan doc |
| `architecture-rebuild-2026-04-17/06-handoffs/autonomous-runs/2026-04-17-w5-3-youtube-metrics.md` | This file |

## Migration applied

Yes — via Supabase MCP `apply_migration` (name: `content_metrics`, returned `{success: true}`).

```sql
CREATE TABLE IF NOT EXISTS public.content_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      text NOT NULL,
  platform_id   text NOT NULL,
  metric_name   text NOT NULL,
  metric_value  numeric,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_content_metrics_platform_id
  ON public.content_metrics (platform, platform_id);
CREATE INDEX IF NOT EXISTS idx_content_metrics_fetched_at
  ON public.content_metrics (fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_metrics_platform_metric_time
  ON public.content_metrics (platform, metric_name, fetched_at DESC);
ALTER TABLE public.content_metrics ENABLE ROW LEVEL SECURITY;
-- Edmund-only RLS policies (select + all).
```

## Deployment

Deployed via Supabase MCP `deploy_edge_function`.

- Function ID: `9261ceb7-3bc3-4a5d-9781-7c9e78a4a71a`
- Slug: `youtube-metrics`
- Version: 1
- `verify_jwt: false`, `status: ACTIVE`
- URL: `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/youtube-metrics`

## Secrets

Pre-existing (shared across Edge Functions — no new secrets needed):
- `CAPTURE_SECRET` ✅
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` ✅
- `YOUTUBE_API_KEY` ✅ (confirmed live — probe against `youtube-ingest` returned API-fetched title/channel without the `youtube_api_key_not_set` warning)
- `YOUTUBE_CHANNEL_ID` ✅ (owned-channel detection working — sample videos returned `is_owned: true`)

## Verification (real endpoint, real DB)

Picked 2 real Edmund-owned videos from `agent_youtube_videos`:
- `jZQ4NOASrqI` — "How to save time in catholic ministry"
- `Y6WEKXwaYdg` — "Grow as a catholic minister with the 3-4-5 zealous framework"

### Request

```bash
curl -sS -X POST "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/youtube-metrics" \
  -H "Content-Type: application/json" \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -d '{"video_ids":["jZQ4NOASrqI","Y6WEKXwaYdg"]}'
```

### Response

```json
{
  "processed": 2,
  "updated": 2,
  "inserted_snapshots": 8,
  "mode": "video_ids",
  "fetched_at": "2026-04-17T19:07:24.608Z",
  "results": [
    { "video_id": "jZQ4NOASrqI", "status": "ok", "updated": true, "inserted_snapshots": 4 },
    { "video_id": "Y6WEKXwaYdg", "status": "ok", "updated": true, "inserted_snapshots": 4 }
  ]
}
```

### DB state after call

**agent_youtube_videos** — both rows updated with fresh counts:

```
video_id        title                                                  view_count  like_count  comment_count  is_owned  channel_name
jZQ4NOASrqI     How to save time in catholic ministry                  551         4           0              true      Edmund Mitchell
Y6WEKXwaYdg     Grow as a catholic minister with the 3-4-5 framework   47          1           0              true      Edmund Mitchell
```

**content_metrics** — 8 snapshot rows inserted (4 per video × 2 videos), all sharing `fetched_at=2026-04-17 19:07:24.608+00`:

```
platform_id   metric_name      metric_value   is_owned
jZQ4NOASrqI   view_count       551            true
jZQ4NOASrqI   like_count       4              true
jZQ4NOASrqI   comment_count    0              true
jZQ4NOASrqI   favorite_count   0              true
Y6WEKXwaYdg   view_count       47             true
Y6WEKXwaYdg   like_count       1              true
Y6WEKXwaYdg   comment_count    0              true
Y6WEKXwaYdg   favorite_count   0              true
```

## Cleanup

No cleanup — snapshots are real Edmund-owned-channel metrics at a real point in time. They stay as the first data points for the dashboard's eventual trend view.

## Key design decisions

1. **Option (c) — update canonical + append snapshot.** Kept `agent_youtube_videos` as current-count source-of-truth (simple reads for W4.4 + agent tools) AND `content_metrics` as time-series. ~4 extra rows per video per call is nothing.
2. **`content_metrics` is platform-agnostic.** Columns are `platform, platform_id, metric_name` — this is the same table W5.4 (Instagram) and W5.5 (Beehiiv) will write into. Dashboard (W5.7) gets cross-channel queries for free.
3. **One row per metric, not one row with N columns.** Vertical shape lets us add new metrics (share_count, retention_pct when Analytics API lands) without altering the schema.
4. **Shared `fetched_at` timestamp per call batch.** Makes "all metrics for this video at this moment" a single-`fetched_at` query — cleaner than deriving from insert times.
5. **`favoriteCount` included.** YouTube still returns it; always `0` in practice (deprecated by YouTube), but cheap to capture and we don't filter-out zero values. Skipped only when YouTube returns the field as absent entirely.
6. **Upsert `agent_youtube_videos` instead of strict update.** Handles the case where a caller passes a `video_id` we haven't ingested yet — the row materializes on first poll rather than silently no-op'ing.
7. **Per-video try/catch — best-effort batch.** One video's DB failure doesn't block the rest. Per-row status lives in `results[]`.
8. **Analytics API (OAuth) out of scope.** Watch-time, retention graphs, traffic sources need OAuth consent — deferred to W5.3b.

## Cost

- YouTube Data API: 2 units (one `videos.list` call with 2 IDs). Daily quota is 10k → trivial.
- Supabase writes: 2 upserts + 8 inserts. Negligible.
- Deploy + migration: free.

Total: essentially zero.

## Follow-ups

- [ ] **W5.3b — YouTube Analytics API** (OAuth) — watch time, retention graphs, traffic sources, demographics. Separate epic: OAuth consent flow + token refresh.
- [ ] **Scheduled task** — wire hourly `limit=20` channel-mode for fresh-upload velocity + daily `limit=200` back-catalogue refresh. Uses Claude scheduled tasks or Supabase pg_cron calling the Edge Function.
- [ ] **W5.4 — Instagram metrics** — same pattern, port `get_instagram_*_insights`.
- [ ] **W5.5 — Beehiiv metrics** — same pattern, newsletter opens/clicks/unsubscribes.
- [ ] **W5.7 — dashboard metrics panel** — read from `content_metrics`, chart trends.

## Charter compliance

- Additive migration only (new table, no schema changes to existing tables).
- Additive Edge Function — new function slug, no edits to capture/youtube-ingest/signals-ingest/capture-mcp.
- Deploy via Supabase MCP (pre-approved per charter).
- Real verification against production DB — Edmund-owned videos only, so snapshot rows are keepers, not test data.
