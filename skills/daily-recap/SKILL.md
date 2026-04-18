---
name: daily-recap
description: Edmund's 9pm daily recap. Use when the scheduled task fires at 21:00 America/Chicago, or when Edmund says "run the daily recap" / "recap today". Queries today's Supabase work_log grouped by project, plus today's approved skill_versions and the count of still-pending proposals, renders a 5-line summary, and posts it to Notion + a dashboard home card. Supports --dry-run (prints to stdout instead of posting).
---

# Daily Recap

Fires nightly at 21:00 America/Chicago. Reads today's shared-brain writes and hands Edmund a 5-line "what moved" summary with a pointer to pending approvals.

## Args

- `--dry-run` — compute the summary, print to stdout, do **not** post to Notion or the dashboard. Use when testing.

## Procedure

1. **Compute "today"** in America/Chicago. All queries use `created_at >= today_start_chicago AND created_at < tomorrow_start_chicago`.

2. **Query shared brain** (Supabase MCP, `execute_sql`):

   ```sql
   -- Today's work_log grouped by project
   SELECT COALESCE(project, 'other') AS project,
          count(*) AS entries,
          array_agg(DISTINCT kind) AS kinds,
          max(created_at) AS last_touch
   FROM work_log
   WHERE created_at >= :today_start AND created_at < :tomorrow_start
   GROUP BY 1
   ORDER BY entries DESC;

   -- Skill_versions approved today
   SELECT skill_name, version
   FROM skill_versions
   WHERE status = 'approved'
     AND approved_at >= :today_start AND approved_at < :tomorrow_start
   ORDER BY approved_at;

   -- Count of still-pending proposals
   SELECT count(*) AS pending
   FROM skill_versions
   WHERE status = 'proposed';
   ```

3. **Render the 5-line template.** Exactly 5 lines + header. Line 1 = the date. Lines 2–4 = top 3 projects by activity (or "(quiet)" if <3). Line 5 = today's approved Skill updates. Footer = pending count + dashboard link.

   ```
   Today — {weekday}, {Mon DD}
   • {project_1}: {kinds_1} — {entries_1} entries
   • {project_2}: {kinds_2} — {entries_2} entries
   • {project_3}: {kinds_3} — {entries_3} entries
   • Skills updated: {skill_name}@v{n}, {skill_name}@v{n} — or "(none)"
   {pending} promotion proposal(s) waiting. /inbox/promotions
   ```

   If fewer than 3 projects had activity, pad with `(quiet)` rows so the shape stays stable.

4. **Post unless `--dry-run`**:
   - **Notion:** append a block to the "Daily Recaps" page (Notion MCP `notion-update-page`). If the page doesn't exist yet, create it under the CEO Desk parent.
   - **Dashboard home card:** upsert one row into `home_cards` (see Follow-ups below) with `kind='daily_recap'`, `key=YYYY-MM-DD`, `body=<rendered markdown>`.

5. **Log it.** Insert one `work_log` row:
   ```sql
   INSERT INTO work_log (session_id, project, kind, summary, artifacts)
   VALUES (null, 'factory', 'note', 'Daily recap posted', jsonb_build_array(jsonb_build_object('kind','recap','date',:today)));
   ```

## Dry-run mode

When invoked with `--dry-run`, print the rendered 5-line summary to stdout and stop. Do not call Notion MCP. Do not touch `home_cards`. Do not insert a `work_log` row. Useful for smoke-testing the query before the 9pm cron.

## Follow-ups (out of MVP scope)

- `home_cards` table doesn't exist yet. **Decision for MVP: skip the dashboard home card.** Post to Notion only, and let Edmund see pending count via `/inbox/promotions`'s own badge. When the home-card surface is ready (future phase), add the upsert back. Rationale: don't outbuild Anthropic — the dashboard sidebar already shows pending-proposal count once wired.
- No email fallback. Notion is the mirror; `/inbox/promotions` is the system of record.

## References

- Schema: `/architecture rebuild 2026-04-17/05-design/phase-1-migrations/README.md`
- Migration 014 (adds `skill_versions.status`): `/architecture rebuild 2026-04-17/05-design/phase-3-migrations/014_skill_versions_add_status.sql`
- Q7 decision: `/architecture rebuild 2026-04-17/03-decisions/decisions-log.md` (2026-04-17)
