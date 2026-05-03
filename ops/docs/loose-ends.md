# Loose ends — convention

**Date:** 2026-05-03 (revised same day after a UX failure: filed loose ends Edmund couldn't act on)
**Status:** Active. Future Claude sessions: follow this when wrapping up.

## Edmund's actual workflow (read this first)

Edmund **does not** run SQL, click into rows, or "knock things out" manually. He tells Claude Code: *"do the loose ends"* (or `/knock-out` once that exists). Everything below is designed for that.

If a loose end can't be acted on by a future Claude session reading just the row, it's not a loose end — it's a note in the wind.

## Two categories — pick one

| Category | When | Format | What happens |
|---|---|---|---|
| **`auto`** — fixable without Edmund's input | Trivial path edit, doc fix, dependency bump, dead-link, missing migration file, etc. Risk is bounded. | description has explicit Action + Success bullets. | Claude runs it on next "do the loose ends" pass and marks complete. |
| **`needs-edmund`** — requires a decision | Architecture call, naming taste, "do we keep X or delete it", anything destructive. | description states the question + options A/B/C. | Claude surfaces it next time, Edmund picks an option, Claude executes. |

If a loose end takes <5 minutes AND is `auto`, **just do it now** instead of filing. Filing it makes more work, not less.

## Required description format

Every `[loose-end]` row's `description` MUST include these sections so a cold Claude session can act:

```
Category: auto | needs-edmund
Risk: low | medium | high
Files involved: <paths>

Action:
- Step 1 …
- Step 2 …

Success:
- <How to verify it's done>

Context:
- <Why this came up, what was tried>
```

Keep each section to bullets, not paragraphs. If the Action section can't be written concretely, the loose end isn't ready — it's a design call (own session).

## Title format

`[loose-end] <imperative phrase>` — e.g. `[loose-end] Fix stale paths in factory/CLAUDE.md` not `[loose-end] CLAUDE.md has stale paths`. Imperative tells the next Claude what to *do*.

## Sample SQL

```sql
INSERT INTO public.agent_tasks (id, from_agent, from_name, from_emoji, to_agent, title, description, status, priority, project_slug)
VALUES (
  gen_random_uuid()::text,
  'claude-code', 'Claude Code', '🤖',
  'edmund',
  '[loose-end] Fix stale paths in factory/CLAUDE.md',
  $body$Category: auto
Risk: low
Files involved: /Users/edmundmitchell/factory/CLAUDE.md (lines 79, 83, 87)

Action:
- Replace `architecture-rebuild-2026-04-17/06-handoffs/autonomy-charter.md` with `ops/autonomy-charter.md` on line 79.
- Update line 83 research-run path to `ops/research/YYYY-MM-DD-<topic>.md`.
- Prefix lines 87+91 decisions-log + open-questions paths with `archive/`.

Success:
- `grep -n "architecture-rebuild-2026-04-17" CLAUDE.md` returns only the table row that intentionally references the archive folder (no other matches).

Context:
- Folder retired 2026-05-02; CLAUDE.md never got updated. Discovered during routing-layer build session.
$body$,
  'pending', 4, 'factory'
);
```

Use Postgres `$body$...$body$` dollar-quoting so multi-line markdown doesn't escape-hell.

## The "knock out" workflow (what Claude does when Edmund says "do the loose ends")

1. Query open auto-category loose ends, lowest priority first:
   ```sql
   SELECT id, title, description, project_slug
   FROM public.agent_tasks
   WHERE status='pending' AND title LIKE '[loose-end]%'
   ORDER BY priority ASC, created_at ASC;
   ```
2. For each `Category: auto` row: parse Action bullets, execute, run Success check, mark complete:
   ```sql
   UPDATE public.agent_tasks
   SET status='approved', completed_at=now(), result='<short summary of what changed>'
   WHERE id='<uuid>';
   ```
3. For each `Category: needs-edmund` row: surface to Edmund with the options, wait for his pick, then execute and mark complete.
4. At the end of the pass, summarize: N done, M waiting on Edmund, K skipped (with reason).

If anything fails Success: mark the task `status='pending'` (no-op) and add a note to `result` explaining what went wrong. Don't fake-complete.

## Why agent_tasks (and not work_log, observations, a Notion task, or a markdown file)

- **work_log** = "what happened." Loose ends are "what didn't happen yet." Different shape.
- **observations** = low-confidence patterns awaiting Corva-style promotion. Loose ends are concrete TODOs, not patterns.
- **Notion tasks** = Edmund's *human* tasks. Cross-system writes are friction; not asked for.
- **Markdown file** = invisible to agents. Defeats the point.

`agent_tasks` is on the dashboard `/tasks` page, queryable by Cordis, persists across sessions. Right home.

## Anti-patterns

- **Don't tell Edmund "remember these."** Humans forget; databases don't.
- **Don't file 30-second fixes.** Just do them.
- **Don't write a vague description.** If you can't write concrete Action bullets, it isn't ready — turn it into a real task or a design call, not a loose end.
- **Don't bury 5 loose ends in one row.** One row = one fix.
- **Don't gold-plate descriptions.** Bullets, not paragraphs. The reader is a busy Claude.
