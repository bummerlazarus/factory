# W5.4 — Instagram post metrics ingest (Edge Function)

**Date:** 2026-04-17
**Status:** 🟡 BLOCKED on Supabase Function secrets (Instagram token + IG account ID).
**Owner:** Autonomous agent
**Predecessor:** W4.4 (youtube-ingest) pattern.
**Sibling:** W5.3 (youtube-metrics) — shares `content_metrics` table.

---

## Goal

Port GravityClaw's Python Instagram tools (`get_instagram_posts`,
`get_instagram_post_insights`, `get_instagram_account_insights`) into a
Supabase Edge Function that pulls per-post metrics from the Meta Graph API
and writes snapshots to Supabase, without requiring GravityClaw's Railway
MCP to stay online.

## Non-goals

- No publish path (`publish_instagram_post`, `publish_instagram_carousel`
  stay in GravityClaw — they use content, not metrics).
- No account-level insights in this ship (can add `/account-insights` later;
  not blocking the dashboard).
- No dashboard UI — pure backend. Dashboard queries `content_metrics` once
  the data is flowing.

---

## Shape

Single POST Edge Function at `dashboard/supabase/functions/instagram-metrics/`.

**Input** (all optional):

```jsonc
{ "since": "2026-04-10T00:00:00Z", "limit": 10, "media_ids": ["17890..."] }
```

**Flow:**

1. Auth via `x-capture-secret` (shared with capture / signals / youtube).
2. Resolve media list:
   - If `media_ids[]` provided → use it directly.
   - Else → `GET /{ig_user_id}/media?fields=id,caption,media_type,timestamp,permalink&limit={limit}&since={unix}`.
3. For each media: `GET /{media-id}/insights?metric=<FULL_METRICS>`. On 400
   (metric not available for media type), retry with `<SAFE_METRICS>`
   (`reach,likes,comments,saved`).
4. Insert one `content_metrics` row per (media_id, metric_name) with
   `platform='instagram'`, `fetched_at=now()`.
5. If `agent_instagram_posts` table exists (probed once per invocation),
   upsert a structural row keyed by `post_id`. Parity with W4.4's
   `agent_youtube_videos`. Not created in this migration — additive when/if
   the dashboard needs it.

**Output:**

```jsonc
{ "processed": 2, "inserted_snapshots": 14, "updated": 0, "errors": 0,
  "has_structural_table": false, "results": [...] }
```

---

## Schema

**`content_metrics`** — already created (W5.3 sibling agent landed this).
Confirmed via `information_schema.tables`. Shape matches the canonical:

```sql
CREATE TABLE public.content_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  platform_id text NOT NULL,
  metric_name text NOT NULL,
  metric_value numeric,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);
```

No new migration for W5.4 — we only write with `platform='instagram'`.

---

## Secrets

Probed via a throwaway `secret-probe` Edge Function (deleted after verify):

| Secret | Status (2026-04-17) |
|---|---|
| `CAPTURE_SECRET` | set (assumed, shared) |
| `INSTAGRAM_ACCESS_TOKEN` | **missing** |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` / `IG_USER_ID` | **missing** |
| `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `FIRECRAWL_API_KEY`, `YOUTUBE_API_KEY`, `BEEHIIV_API_KEY` | set |

**Blocker:** Edmund needs to set `INSTAGRAM_ACCESS_TOKEN` and
`INSTAGRAM_BUSINESS_ACCOUNT_ID` (or `IG_USER_ID`) in Supabase → Project
Settings → Edge Functions → Secrets. GravityClaw's `.env.local` has them;
same values apply.

Once set, re-verify:

```bash
curl -sS -X POST \
  "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/instagram-metrics" \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -H "content-type: application/json" \
  -d '{"limit": 1}' | jq
```

---

## Graph API notes

- Version pinned: `v21.0` (matches GravityClaw).
- Rate limit: 200 req/user/hour shared across all endpoints. Listing + per-post
  insights means ~(1 + N) calls per run. `limit=20` → 21 req → fine.
- Insights metric availability depends on media_type (IMAGE, VIDEO, REEL,
  CAROUSEL_ALBUM). Graph API returns HTTP 400 if you ask for an unsupported
  metric. We detect this and retry with a smaller set rather than skipping
  the post.
- Token expiry: long-lived tokens last ~60 days. If Edmund sees 401s in
  production, re-mint via the [Graph API Explorer](https://developers.facebook.com/tools/explorer/).

---

## What we're NOT doing (yet)

- No account-level insights endpoint. When we want daily account reach /
  follower_count / profile_views, add a second function path or a second
  POST body shape (`{"mode": "account", "days": 7}`). The Python source for
  that is `get_instagram_account_insights` in
  `reference/reference-repos/gravityclaw/tools/instagram.py`.
- No Pinecone / `memory` embedding of captions here — this is metrics-only.
  If we want captions searchable, port `ingest_instagram_content` into a
  separate W5.x Edge Function that writes to `public.memory`.
- No `agent_instagram_posts` schema migration. Additive if/when needed.

---

## Rollback

Delete the function: `supabase functions delete instagram-metrics`. No
database rollback required (no new tables, only inserts).

---

## Links

- Plan: this file
- Edge Function: `dashboard/supabase/functions/instagram-metrics/index.ts`
- README: `dashboard/supabase/functions/instagram-metrics/README.md`
- Run log: `architecture rebuild 2026-04-17/06-handoffs/autonomous-runs/2026-04-17-w5-4-instagram-metrics.md`
- Meta Graph IG Media Insights docs: https://developers.facebook.com/docs/instagram-platform/api-reference/ig-media/insights
- Python source (GravityClaw): `reference/reference-repos/gravityclaw/tools/instagram.py`
