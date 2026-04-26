# W5.9 — "Educated bets" Skill — plan

**Date:** 2026-04-17
**Backlog entry:** W5.9 (depends on W5.8 "Double-down", shipped commit `7603c97`)
**Status when plan written:** ⚪ → targeting 🟢

---

## What this is

A **forward-looking** weekly Skill. Complement to W5.8 Double-down (which looks
backward at last week's top performers). Educated-bets looks at the same
top performers and proposes NEXT ANGLES: "because X worked, try Y."

The goal isn't great copy — it's to **guarantee there's always something
sitting in the inbox on Monday morning**. Template-only, pure SQL, no LLM
calls. LLM drafting happens when Edmund clicks into a bet.

## Shape (matches W5.8 and W6.1 Librarian)

- One Postgres function: `public.educated_bets_scan(lookback_days int, top_n int) RETURNS jsonb`
- One pg_cron job: `educated-bets-weekly`, Monday 09:00 UTC
- Lands rows in `public.reference_docs` with `kind='educated-bet'`
- Idempotent slug: `bet-<YYYY-MM-DD>-<md5(template|fragment)[:10]>`
- `ON CONFLICT (slug) DO NOTHING` — same-day re-runs are no-ops

## How it works

1. **Pick top performers** in the window from `content_metrics_unified`:
   YouTube `view_count` + Beehiiv `web_views`, latest snapshot per
   `(platform, platform_id)`, ranked by `metric_value`.
2. **Extract patterns:**
   - Top 5 tags across top-20 performers (join `agent_youtube_videos.tags`, unnest, count).
   - Top 5 keywords from titles of top-10 (lowercase, split on non-word, stopword-filter).
3. **Emit bet rows** — three deterministic templates, LIMIT `top_n`:
   1. **double-hook-variant** — anchored on the #1 performer. Always emits when any candidate exists.
   2. **platform-cross-post** — anchored on the best performer on the OPPOSITE platform from #1. Falls through when only one platform has data.
   3. **framework-deepen** — uses top tag if present; falls back to top keyword; final fallback to "deepen the anchor."
4. Insert to `reference_docs`. Count inserts (`proposed`) vs conflicts (`skipped_existing`).

## Why three templates, not twenty

Quality over breadth. The spec says "pick 3-5 for v1" — we picked 3 with
graceful degradation so every weekly run will land at least 1-2 bets even
with thin data (current reality: 2 YouTube videos, 0 Beehiiv). More
templates can be added without changing the public function signature.

## Idempotency

Three layers:

- Slug encodes `YYYY-MM-DD` + `md5(template|dedup_fragment)`. Same-day re-run → same slug → ON CONFLICT DO NOTHING.
- Migration uses `CREATE EXTENSION IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`, `CREATE OR REPLACE FUNCTION`. Re-apply is a no-op.
- pg_cron schedule wrapped in `DO … PERFORM cron.unschedule(...) EXCEPTION WHEN OTHERS THEN NULL` before `cron.schedule`. Re-schedule is idempotent.

## Coexistence with W5.8

W5.8 added `kind='promotion'` to the `reference_docs_kind_check` constraint.
This migration preserves that and adds `'educated-bet'` — it rebuilds the
full list (`goal, value, kpi, framework, claude_md, principle, persona,
playbook, doc, cluster, promotion, educated-bet`). Does not touch W5.8's
function or cron job.

## Out of scope (follow-ups)

- Beehiiv title-keyword signal (currently no Beehiiv rows in snapshot table).
- Channel clustering for Beehiiv (`channel_name` doesn't exist on beehiiv side yet).
- "Audience-ask mirror" template — requires question-typed observation rows; defer until observation kinds are richer.
- Split into a dedicated `educated_bets` table when the inbox moves fully to Supabase (same follow-up as W5.8).

## Deliverables

1. `/Users/edmundmitchell/factory/dashboard/supabase/migrations/20260417100000_educated_bets_skill.sql`
2. Applied via Supabase MCP `apply_migration` to project `obizmgugsqirmnjpirnh`
3. This plan doc
4. Run log at `06-handoffs/autonomous-runs/2026-04-17-w5-9-educated-bets.md`
5. Backlog W5.9 → 🟢
