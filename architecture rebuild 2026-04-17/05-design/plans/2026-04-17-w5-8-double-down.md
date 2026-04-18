# W5.8 — "Double-down" Skill

**Date:** 2026-04-17
**Status:** 🟢 Done
**Pattern:** Postgres function + pg_cron (mirrors W6.1 Librarian)

## Goal

Nightly scan of `content_metrics` — for each platform (YouTube, Beehiiv), surface the top N over-indexing pieces in a lookback window and queue template-drafted follow-ups as "promotions". These are candidates for Edmund to open and LLM-draft into real follow-up content.

## Decisions

### Destination table: `reference_docs` with `kind='promotion'` (fallback path)

Recon showed there is no dedicated `promotions` table. The dashboard's
`/inbox/promotions` page (`dashboard/app/inbox/promotions/page.tsx`) reads from
`skill_versions` — that's the _Corva-style "skill update promotion"_ flow, not
content promotions. Different noun sharing the same word.

The W5.8 spec anticipated this and specified the fallback: write to
`reference_docs` with `kind='promotion'`. That's what we did, extending the
existing CHECK constraint (same pattern W6.1 used to add `'cluster'`).

**Follow-up:** when the dashboard grows a dedicated content-promotions inbox,
split into its own ephemeral table (`content_promotions` or similar).
Promotions are transient; `reference_docs` are semantically permanent. This is
a known mismatch, documented in the migration header.

### "Top performer" definition (v1)

Per platform, take the **latest** snapshot in the lookback window
(`DISTINCT ON (platform, platform_id) ... ORDER BY fetched_at DESC`), then
rank by metric value and take top N:

- **YouTube:** `metric_name='view_count'` (from `content_metrics`).
- **Beehiiv:** `metric_name='web_views'` (from `beehiiv_post_metrics` via the
  unified view). Email-opens was an alternative; we picked web_views because
  it matches YouTube's "reach" framing.

Top-N-per-platform (not top-N overall) so small-sample platforms still
surface candidates.

### Draft content: static template only

The Skill's job is to **surface** candidates. LLM drafting happens when
Edmund clicks into the item. Template includes: platform, content ID, title,
metric + value, measured-at, URL if available, and a generic "consider a
follow-up" angle.

### Idempotency

Slug `promotion-<YYYY-MM-DD>-<platform>-<platform_id>` with
`ON CONFLICT (slug) DO NOTHING`. Dedup key = date + platform + platform_id.
Running the function twice on the same day produces the same rows and counts
conflicts as `skipped_existing`.

## Schedule

`cron.schedule('double-down-nightly', '0 8 * * *', 'SELECT public.double_down_scan(7, 5)')`
— 08:00 UTC daily, lookback 7 days, top 5 per platform.

## Deliverables

- `dashboard/supabase/migrations/20260417080000_double_down_skill.sql`
- Applied as Supabase migration `double_down_skill` on project `obizmgugsqirmnjpirnh`
- Run log: `06-handoffs/autonomous-runs/2026-04-17-w5-8-double-down.md`
- Backlog flipped W5.8 to 🟢

## Follow-ups

1. **Split promotions out of reference_docs** when a dedicated surface exists.
2. **Instagram / Circle metrics** — `double_down_scan` only knows YouTube +
   Beehiiv today. Add a platform case when W5.4 Instagram metrics and W5.6
   Circle metrics land.
3. **Delta-based signal (not level)** — v1 picks top by absolute metric value.
   True "over-indexing" needs a baseline (compare this window's views to the
   piece's average). Requires more metric history; revisit once `content_metrics`
   has multiple snapshots per piece.
4. **W5.9 "Educated bets" Skill** — unblocked by this.
