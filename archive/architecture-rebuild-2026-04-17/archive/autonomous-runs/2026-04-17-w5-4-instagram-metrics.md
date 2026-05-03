# W5.4 Autonomous run — Instagram post metrics ingest

**Date:** 2026-04-17
**Status:** 🟡 BLOCKED on Supabase Function secrets (deployed code path live; pending Instagram token + account ID to complete verification).
**Operator:** Autonomous agent (Claude Opus 4.7 1M)
**Plan:** [../../05-design/plans/2026-04-17-w5-4-instagram-metrics.md](../../05-design/plans/2026-04-17-w5-4-instagram-metrics.md)

---

## What shipped

- Edge Function `instagram-metrics` v1 deployed to project `obizmgugsqirmnjpirnh`, `verify_jwt=false`.
  - URL: `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/instagram-metrics`
  - Function ID: `6609efbd-f630-4950-80b3-db58b25bed12`
- Source: `dashboard/supabase/functions/instagram-metrics/index.ts` (382 lines).
- README: `dashboard/supabase/functions/instagram-metrics/README.md`.
- Plan doc: `../../05-design/plans/2026-04-17-w5-4-instagram-metrics.md`.

## What did NOT need to happen

- **No migration.** The W5.3 YouTube metrics sibling already landed `public.content_metrics` with the canonical shape. Confirmed via `information_schema.tables` + column inspection before proceeding. W5.4 only writes `platform='instagram'` rows into that existing table.
- **No `agent_instagram_posts` migration.** Table does not exist. The Edge Function probes for it on each invocation and only writes structural rows when it's present. Parity with W4.4's `agent_youtube_videos` pattern without forcing schema now.

## Blockers (why not 🟢 yet)

Instagram Graph API secrets are not set on Supabase Edge Functions. Probed via a throwaway `secret-probe` Edge Function (now neutered, returns 410 Gone, safe to delete):

```
INSTAGRAM_ACCESS_TOKEN          : NOT SET
INSTAGRAM_BUSINESS_ACCOUNT_ID   : NOT SET
IG_USER_ID                      : NOT SET
(OPENAI_API_KEY, GOOGLE_API_KEY, FIRECRAWL_API_KEY, YOUTUBE_API_KEY, BEEHIIV_API_KEY all SET)
```

Per check-in triggers in the dispatch, I stopped short of live verification. The deployed function correctly surfaces the missing config instead of silently failing:

```bash
curl -sS -X POST "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/instagram-metrics" \
  -H "x-capture-secret: <CAPTURE_SECRET — see ops/.env (gitignored)>" \
  -H "content-type: application/json" -d '{"limit": 1}'
# HTTP 500
# {"error":"server_misconfigured","detail":"INSTAGRAM_ACCESS_TOKEN not set"}
```

Wrong-secret case also tested:

```bash
curl -sS -X POST "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/instagram-metrics" \
  -H "x-capture-secret: wrong" -d '{}'
# HTTP 401
# {"error":"unauthorized"}
```

## What Edmund needs to set

In Supabase Studio → Project Settings → Edge Functions → Secrets (project `obizmgugsqirmnjpirnh`), add:

| Secret | Value source |
|---|---|
| `INSTAGRAM_ACCESS_TOKEN` | GravityClaw `web/.env.local` → long-lived Meta user/page token. |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | GravityClaw `web/.env.local` → numeric IG Business Account ID (17 digits). |

Or via CLI:

```bash
supabase secrets set \
  INSTAGRAM_ACCESS_TOKEN="..." \
  INSTAGRAM_BUSINESS_ACCOUNT_ID="..." \
  --project-ref obizmgugsqirmnjpirnh
```

Then verify:

```bash
curl -sS -X POST \
  "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/instagram-metrics" \
  -H "x-capture-secret: <CAPTURE_SECRET — see ops/.env (gitignored)>" \
  -H "content-type: application/json" \
  -d '{"limit": 1}' | jq
```

Expect `processed: 1`, `inserted_snapshots > 0`, `errors: 0`. Snapshot data:

```sql
select platform_id, metric_name, metric_value, fetched_at
from content_metrics
where platform = 'instagram'
order by fetched_at desc
limit 20;
```

Once that succeeds, flip W5.4 to 🟢 in the backlog (run-log entry still applies).

## Files changed

- `dashboard/supabase/functions/instagram-metrics/index.ts` (new, 382 lines)
- `dashboard/supabase/functions/instagram-metrics/README.md` (new)
- `architecture-rebuild-2026-04-17/05-design/plans/2026-04-17-w5-4-instagram-metrics.md` (new)
- `architecture-rebuild-2026-04-17/06-handoffs/autonomous-runs/2026-04-17-w5-4-instagram-metrics.md` (this file)
- `architecture-rebuild-2026-04-17/06-handoffs/backlog.md` — W5.4 row updated to 🟡 with blocker note.

## Cleanup TODO

- Delete `secret-probe` Edge Function (currently returns `410 Gone`; harmless but unused). `supabase functions delete secret-probe --project-ref obizmgugsqirmnjpirnh`.

## Notes / decisions

- Graph API version pinned to `v21.0`, same as GravityClaw `instagram.py`.
- Metric list: full = `impressions,reach,saved,likes,comments,shares,total_interactions,video_views`; safe fallback = `reach,likes,comments,saved`. Graph API returns 400 for metrics unsupported by the media type (classic IMAGE-vs-REEL divergence). Each post's response records `metric_set: "full" | "safe"` for downstream observability.
- `since` param: accepts ISO8601 in the request body, converts to Unix seconds for Graph API (which requires numeric `since`, same gotcha as Lab Note #2 in GravityClaw CLAUDE.md).
- Structural upsert (`agent_instagram_posts`) is guarded by a per-invocation probe. First tries `information_schema.tables` via PostgREST; falls back to a direct table select if PostgREST can't reach it. `has_structural_table` in the response lets callers observe which path ran.
- No account-level insights in this ship (Edmund's W5.4 spec was post-level). `get_instagram_account_insights` port is cheap to add later if/when dashboard wants daily account-level reach/follower_count.
