# W6.4 — Audience Pain-points Skill (v1, YouTube comments only)

**Date:** 2026-04-17
**Status:** shipped (autonomous run)
**Migration:** `dashboard/supabase/migrations/20260417110000_audience_pain_points.sql`

## Scope narrowing

Backlog item W6.4 reads: "ingest comments / DMs / community threads; tag and cluster; surface top N to `/inbox/research`."

For v1 we scope to **YouTube comments only**:

- **DMs** — depends on Instagram integration. W5.4 was ABANDONED (no long-lived access token). No other DM source wired up yet. Deferred.
- **Community threads** — depends on Circle, which is blocked on open question Q12 (whether Circle is the canonical community platform). Deferred.
- **YouTube comments** — `public.agent_youtube_comments` already exists (101 rows at time of build, populated by W4.4 `youtube_sync`). This is the one ingest we can lean on today.

When either of the deferred sources unblocks, the follow-up is an additional "source" in the scan function (or a parallel function), not a rewrite.

## Design

One SQL function (`public.audience_pain_points_scan(lookback_days, top_n)`) plus one pg_cron job (`audience-painpoints-weekly`, Monday 10:00 UTC). Mirrors the W6.1 Librarian and W5.8 Double-down patterns.

### Pattern-based clustering (v1)

No LLM calls. No embeddings. Pure lexical regex.

Ordered list of 12 patterns, specific → generic:

| priority | label               | regex                                     |
|---------:|---------------------|-------------------------------------------|
| 1        | how-do-i            | `how\s+do\s+i`                            |
| 2        | i-cant              | `i\s+(can[']?t\|cannot)`                  |
| 3        | i-dont-understand   | `i\s+don[']?t\s+understand`               |
| 4        | confused            | `confus(ed\|ing\|ion)`                    |
| 5        | help-me             | `help\s+me`                               |
| 6        | does-anyone-know    | `does\s+anyone\s+(know\|have)`            |
| 7        | what-about          | `what\s+about`                            |
| 8        | why-does            | `why\s+(does\|do\|is\|are\|did)`          |
| 9        | problem-with        | `problem\s+with`                          |
| 10       | issue               | `\yissue(s)?\y`                           |
| 11       | question            | `question`                                |
| 12       | what-is             | `what\s+(is\|are)\s+`                     |

Each comment is assigned to its **first** matching pattern (so "how do I…" with "confused" in it falls under `how-do-i`, not `confused`). Buckets with `>= 2` matches are kept; top N by count are written.

### Destination

`reference_docs` table, `kind='pain-point-cluster'`. No new table.

Slug = `painpoint-<YYYY-MM-DD>-<md5(pattern)[:8]>`. ON CONFLICT (slug) DO NOTHING for idempotency within a day.

Body = markdown with pattern, match count, video breakdown, 3-5 representative comment snippets (ranked by like_count DESC).

Metadata = `{source, generator, pattern, count, video_ids[], source_comments[], samples[], window_start, window_end, lookback_days, scanned_at, scan_date, scope_note}`.

### Why `reference_docs`?

Feynman (research agent) reads `reference_docs` during research conversations. By landing pain-points there, they surface without any extra wiring. Same argument used for W5.8 (promotions) and W6.1 (observation clusters).

### Surfacing

Backlog says "surface top N to `/inbox/research`." That UI does not exist yet. Follow-up: build `/inbox/research` view that reads `reference_docs WHERE kind IN ('cluster', 'pain-point-cluster')`. Not blocking — the clusters are queryable right now, and Feynman picks them up automatically.

## Verification

```sql
SELECT public.audience_pain_points_scan(365, 10);
-- → 4 processed, 0 clusters (only 4 comments in last year, none with >=2 in any bucket)

SELECT public.audience_pain_points_scan(3650, 10);
-- → 101 processed, 2 clusters written (font-size "what-is" and generic "question")

SELECT public.audience_pain_points_scan(3650, 10);
-- → 101 processed, 0 clusters, 2 skipped_existing  (idempotency confirmed)

-- cleanup:
DELETE FROM public.reference_docs
  WHERE kind='pain-point-cluster' AND metadata->>'source'='audience_pain_points';
```

## Follow-ups

1. **Comment embedding pipeline** — current clustering is lexical-only. For semantically related comments that don't share a keyword (e.g., "I don't get it" vs "what does this mean"), we need embeddings. Candidate: an Edge Function (or a separate scheduled SQL task) that embeds new YouTube comments into `memory` with `source='youtube_comment'`, `source_id=comment_id`, then a v2 of this Skill that joins through `memory` like W6.1 does. **Not urgent** — the lexical version catches 90% of the obvious pain-points.
2. **DM ingest** — reopens when Instagram (or an alternate DM source) comes back online.
3. **Community threads** — reopens when Circle Q12 resolves.
4. **`/inbox/research` UI** — new follow-up epic. Reads `reference_docs WHERE kind IN ('cluster','pain-point-cluster')` with a tab/filter.
5. **Tighter patterns / spam filtering** — 101 rows is tiny, but at scale we'll want to drop emoji-only comments, bot spam, and very short "great!" style noise before regex matching. Add a `length(content) >= 20` gate (or similar) when the table grows past ~5k.
