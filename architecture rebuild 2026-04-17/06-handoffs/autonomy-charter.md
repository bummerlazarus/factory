# Autonomy Charter

**Status:** Draft 2026-04-17. Edmund reviews + edits before first autonomous run. Governs any Claude session (or scheduled task) working the backlog at `06-handoffs/backlog.md` without synchronous check-ins.

## Purpose

Let a Claude orchestrator work the rebuild backlog top-to-bottom, dispatching subagents for plan / execute / review / verify, and writing a readable audit trail so Edmund can review async. Default mode: proceed when green, stop and escalate when anything in the hard-stop or check-in list triggers.

## Operating mode

1. **Pick** the next unblocked backlog item (see `backlog.md`).
2. **Plan** — dispatch `Plan` subagent. Plan is written to `05-design/plans/YYYY-MM-DD-<slug>.md`. Plan must have acceptance criteria + verification steps.
3. **Execute** — dispatch execution subagent(s) in a git worktree (`superpowers:using-git-worktrees`). Use parallel subagents when tasks are independent (`superpowers:dispatching-parallel-agents`).
4. **Review** — dispatch `code-reviewer` subagent against the plan.
5. **Verify** — run acceptance criteria (tests, smoke tests, `preview_*` for UI). No verification-theater: real output, not assertions.
6. **Log** — write run entry to `06-handoffs/autonomous-runs/YYYY-MM-DD-<epic-id>.md`. Update `backlog.md` status column.
7. **Loop** — pick the next item.

Parallelism is OK when epics are independent (Phase 2 and Phase 3 already ran in parallel — see the execution logs). Serialize anything with shared files or DB migrations.

## Allowed actions (proceed without asking)

- Read / edit / write in `/factory/dashboard/`, `/factory/skills/`, `/factory/agents/`, `/factory/supabase/`, `/factory/ops/scripts/`, `/factory/architecture rebuild 2026-04-17/`, and `/factory/pinecone/` (when it exists).
- Run tests, type checks, linters, formatters.
- Start / stop the dashboard dev server via `preview_*` tools.
- Deploy to **Vercel preview** environments only.
- Create git branches, worktrees, commits. Push feature branches.
- Create non-destructive Supabase migrations (CREATE / ADD COLUMN / CREATE INDEX / CREATE FUNCTION). Apply to the live project when the migration is additive-only and idempotent.
- Call Supabase / Pinecone / Notion / Firecrawl / Vercel MCPs for reads and idempotent writes.
- Create Supabase Storage buckets / Edge Functions (deploy to dev/preview).
- Dispatch subagents (Plan, Explore, general-purpose, code-reviewer).
- Write to this notebook: `04-audit/`, `05-design/`, `06-handoffs/autonomous-runs/`, `03-decisions/decisions-log.md` (append entries for decisions actually made during the run).
- Update `MEMORY.md` + individual memory files when scope truly changes.

## Hard stops (never without explicit approval)

- Production deploy / promotion to the `edmund.dev`-class domain.
- **Destructive SQL**: `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE` without a narrow `WHERE`, `ALTER TYPE` that loses data.
- Data migrations on live tables containing real data (read-only staging OK).
- Decommissioning GravityClaw / Railway / Pinecone — even after dual-read parity.
- Deleting files from `/Users/edmundmitchell/gravityclaw/` or `/research/`.
- `git push --force`, branch deletions, history rewrites, `--no-verify`.
- Adding or upgrading paid SaaS; buying domains; changing billing plans.
- Adding new MCP servers to the Claude config.
- Changing auth / RLS policies on live Supabase beyond what's in the plan.
- Approving `skill_versions` rows with status `proposed` (Edmund's taste call).
- Resolving any open question in `03-decisions/open-questions.md` (Q1, Q3, Q8, Q10, Q12, etc.). Surface to Edmund.
- Changing anything in `/Users/edmundmitchell/gravityclaw/`, `/Users/edmundmitchell/factory/production/`, or `/Users/edmundmitchell/.claude/` beyond memory updates.
- Spending via OpenAI / Anthropic / third-party APIs beyond a **$10/run embedded-model / LLM-call cap** (approved by Edmund 2026-04-17). Typical epic cost is cents — anything sustained means something is wrong.

## Check-in triggers (stop, write decision prompt, wait)

- Verification fails twice on the same epic after fix attempts.
- Plan requires a hard-stop action to finish.
- Acceptance criteria are ambiguous after a reasonable read.
- Subjective / taste judgment needed (naming, voice, visual design choices).
- An open question from `open-questions.md` becomes blocking.
- Cross-epic dependency surfaces that changes ordering.
- Unexpected state in the repo or DB (files you didn't write, rows you didn't expect) — investigate, don't overwrite.
- MCP tool fails twice (per Edmund's standing rule).
- About to touch anything not explicitly allowed above.
- Any action whose blast radius is larger than the current worktree.

When a trigger fires: stop, write `06-handoffs/autonomous-runs/YYYY-MM-DD-<epic-id>-BLOCKED.md` with the question framed for quick answer, update `backlog.md` status to `🟡 BLOCKED`, move to next independent epic if one exists or end the run.

## Run log protocol

One markdown file per run, in `06-handoffs/autonomous-runs/`. Minimum fields:

- Epic ID + title
- Plan file path
- Status: `🟢 DONE` | `🟡 BLOCKED` | `🔴 ABANDONED`
- Files touched (list)
- Supabase migrations applied (list with names)
- Subagents dispatched (count + type)
- Verification output (paste, not summarize, for non-trivial checks)
- Decisions made (if any — link to decisions-log entry)
- Follow-ups flagged
- Cost (rough token / $ estimate if material)
- What's next in the backlog

## Safety net

- **Always in a git worktree** for code changes. Main branch untouched until Edmund merges.
- **Commits, not amends.** Never `--amend` an existing commit without Edmund asking.
- **Small diffs.** If an epic's diff exceeds ~500 net lines, split and re-plan.
- **Idempotent migrations.** Every migration must be safe to re-run.
- **Dual-read before cutover.** Any migration from system A to system B runs in parallel for at least one verification cycle before A is decommissioned.
- **Preserve the audit trail.** Execution logs stay as-is; new logs are new files.

## Status signals on the backlog

| Symbol | Meaning |
|---|---|
| ⚪ | Not started |
| 🟢 | Done + verified |
| 🔵 | In flight (current run) |
| 🟡 | Blocked — needs Edmund |
| 🔴 | Abandoned / superseded |
| ⛔ | Depends on an open question |

## Escalation / kill switch

Edmund can:
- **Pause:** delete or rename `06-handoffs/autonomy-charter.md`. A run that reads the charter and finds it missing must halt.
- **Redirect:** edit `backlog.md` priority order or mark items `⛔`.
- **Abort a specific run:** set the run-log file's status to `🔴 ABANDONED` and the orchestrator must not resume that epic without fresh instructions.

A scheduled task checks the charter exists and `backlog.md` has unblocked `⚪` items before starting each run. If either is missing, the run exits without touching anything.

## First run

Before the first autonomous run:
1. Edmund reads + edits this charter.
2. Edmund reads + edits `backlog.md`, especially the priority order.
3. Edmund confirms: "go."
4. First run starts with the top unblocked `⚪` item.

## Cadence

**No scheduled cadence — continuous run mode** (approved by Edmund 2026-04-17). Orchestrator works backlog top-to-bottom until one of:
- Backlog has no unblocked `⚪` items.
- A `🟡 BLOCKED` item requires Edmund's input and no independent epic is available.
- Edmund steps in to stop or redirect.
- Finished state reached (see `05-design/finished-state.md` verification checklist).

## Changes

- **2026-04-17** — Initial draft.
- **2026-04-17** — Edmund approvals applied: cost cap $5 → $10; continuous run cadence confirmed; additive Supabase migrations directly to live are pre-approved (no per-epic check-in); Edmund delegates priority order.
