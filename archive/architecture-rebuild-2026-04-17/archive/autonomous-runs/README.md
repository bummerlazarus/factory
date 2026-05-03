# Autonomous Runs

Log directory for runs executed under `../autonomy-charter.md`.

## File naming

`YYYY-MM-DD-<epic-id>.md` — e.g. `2026-04-20-W1.1.md`.

Append `-BLOCKED` if the run hit a check-in trigger: `2026-04-20-W1.1-BLOCKED.md`.

If a single epic spans multiple runs, suffix: `2026-04-20-W1.1-part2.md`.

## Required sections (orchestrator writes these)

1. **Epic** — ID, title, link to `backlog.md` row
2. **Plan** — path to `05-design/plans/YYYY-MM-DD-<slug>.md`
3. **Status** — `🟢 DONE` / `🟡 BLOCKED` / `🔴 ABANDONED`
4. **Files touched** — flat list
5. **Supabase migrations applied** — names + one-line purpose
6. **Subagents dispatched** — count + type (Plan / Explore / code-reviewer / general-purpose)
7. **Verification output** — paste the actual command output for non-trivial checks
8. **Decisions made** — link to `03-decisions/decisions-log.md` entry if any
9. **Follow-ups flagged** — things Edmund or a later epic should handle
10. **Cost** — rough token / $ estimate if material (migrations with embedding calls, e.g.)
11. **What's next** — the next unblocked backlog item

## Precedent

The existing execution logs in `../` (phase-2, phase-3, supabase-migration handoff) set the shape. Use them as templates.

## Review cadence

Edmund reviews these async — no specific cadence imposed. Run logs collect; Edmund reads them in the sidebar at his pace. Anything needing his input is `🟡 BLOCKED` and has a decision prompt at the top of the log.
