# Loose ends — convention

**Date:** 2026-05-03
**Status:** Active. Future Claude sessions: follow this when wrapping up.

## TL;DR

When a session ends with **known follow-ups that aren't blocking and don't have an immediate next step**, write them to `public.agent_tasks` with the `[loose-end]` title prefix. Don't tell Edmund to "remember" or "write it down" — that's Edmund doing your job.

## The rule

At the end of any session where you say something like "X is a loose end" / "worth fixing later" / "outstanding follow-up" / "by the way I noticed Y but didn't fix it":

**Insert a row into `public.agent_tasks`** with:
- `id`: `gen_random_uuid()::text`
- `from_agent`: `'claude-code'` (or whichever agent surfaced it)
- `from_name`: `'Claude Code'`
- `from_emoji`: `'🤖'`
- `to_agent`: `'edmund'`
- `title`: `'[loose-end] <one-line summary>'` — keep the prefix consistent so they're filterable
- `description`: enough context for a future session (or Edmund) to act without re-discovering. Include file paths, dates, the reason it's a loose end (not blocking? needs design call? out of scope today?).
- `status`: `'pending'`
- `priority`: `4` (low) for routine loose ends; bump to `2` or `3` if there's a deadline or risk
- `project_slug`: the workstream this belongs to (`factory`, `em-brand`, etc.)

Sample SQL:

```sql
INSERT INTO public.agent_tasks (id, from_agent, from_name, from_emoji, to_agent, title, description, status, priority, project_slug)
VALUES (
  gen_random_uuid()::text,
  'claude-code', 'Claude Code', '🤖',
  'edmund',
  '[loose-end] Stale references in factory/CLAUDE.md',
  'Lines 79/83/87 still point at retired architecture-rebuild folder paths. Update to archive/ paths or current canonical homes. Discovered 2026-05-03.',
  'pending', 4, 'factory'
);
```

## Why agent_tasks (and not work_log, observations, a Notion task, or a markdown file)

- **work_log** = "what happened." Loose ends are "what didn't happen yet." Different shape.
- **observations** = low-confidence patterns awaiting human approval (Corva's promotion path). Loose ends are concrete TODOs, not patterns.
- **Notion tasks** = where Edmund's *human* tasks live. Cross-system writes are friction; he hasn't asked us to push there yet. Stay in Supabase.
- **Markdown file** (`/loose-ends.md` or similar) = invisible to agents until someone reads it. The point is durability + agent-surfaceable.

`agent_tasks` is already on the dashboard at `/tasks`, queryable via `route_query` intent=`workflow_planning` (skill_versions + agent_scheduled_tasks + agent_tasks), and visible to Cordis. It's the right home.

## How they get surfaced

- **Dashboard** `/tasks` page lists them. Edmund sees them when he opens the tab.
- **Cordis** can query for them with the `[loose-end]` title filter:
  ```sql
  SELECT id, title, description, project_slug, created_at
  FROM public.agent_tasks
  WHERE status='pending' AND title LIKE '[loose-end]%'
  ORDER BY priority ASC, created_at DESC;
  ```
- **Future enhancement (not today):** add a dedicated `loose_ends_open` view + a `retrieve` intent that queries it.

## How they get closed

When Edmund (or an agent) handles one:
- `UPDATE agent_tasks SET status='approved', completed_at=now(), result='<what was done>' WHERE id='<uuid>';`
- Or via the dashboard's `/tasks` UI if it supports completion (it does).

## Anti-patterns

- **Don't tell Edmund "remember these"** — humans forget; databases don't. Write them.
- **Don't bury them in a long closeout summary** — the closeout becomes a blob nobody re-reads. One row per loose end, queryable.
- **Don't gold-plate** — loose ends should take 30 seconds each to write. If you find yourself drafting a 200-word description, either it's a real task (priority ≥ 3 with a clear next step) or a design call (worth its own session, not a loose end).
