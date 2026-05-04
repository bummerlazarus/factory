# Work Loop v2 — Execution Retro

**Date:** 2026-05-03
**Plan:** [`ops/plans/2026-05-03-dashboard-work-loop.md`](../plans/2026-05-03-dashboard-work-loop.md)
**Outcome:** All 6 phases shipped to `dashboard/` `main`. Each phase is a single commit.

## What shipped

| Phase | Commit | What it does |
|---|---|---|
| 1 | `00e0b23` | `createTask` now validates `from_agent` / `to_agent` exist in `public.agents` (with `triage` / `system` pseudo-sender allowlist). |
| 2 | `dec5f3c` | New `/today` page + API + `work_loop_today_v` view. Three lanes: Needs You / In Flight / Recently Shipped. Sidebar entry. Stale CLAUDE.md sentence corrected. |
| 3 | `b2f337c` | `updateTask` → `recordTaskCompletion`: writes a `work_log` retro row and appends a `[task:<id>]` line to the linked workspace item. DB unique partial index makes it idempotent. |
| 4 | `f5fd0b4` | `/api/cron/triage-captures` runs every 15min. Fresh captures (<24h) get an LLM-driven disposition; aged (>5d) get force-archive. Vercel cron entry added. Approval arm in `/api/promotions/proposal` handles all 4 actions. |
| 5 | `586846a` | `propose_skill` + `propose_pattern` tools. Approval inserts a `skill_versions` row at next version (status=approved); `pattern_observation` is acknowledgment-only. |
| 6 | `96267f9` | Per-agent gating: when calling agent has `tool_tags @> {gated_workspace}`, `create_workspace_item` files a `kind='workspace_item'` proposal instead of writing directly. Slug returned up-front so agent can reference it pre-approval. |

## Surprises / deviations from plan

1. **`proposals.kind` was constrained, not free-form.** Plan described `proposals` as a "universal queue" where `kind` is just text. The DB had `proposals_kind_check` allowing only `skill / persona-edit / memory-entry`. First triage insert hit it. **Fix:** added migration `20260503120100_proposals_kind_check_widen.sql` widening to all 7 kinds the plan introduces. **Lesson:** when a plan reuses an existing table, grep for `pg_constraint` rows referencing that table before assuming the column is open.

2. **`agents.id = 'axel'` doesn't exist.** Plan referenced `axel` and `sophia` as concrete agent IDs in test scripts. Real IDs are `ceo`, `content`, `cordis`, `designer`, `contradiction`, etc. Verifications swapped to `ceo` for both Phase 5 and Phase 6 tests. The plan flagged this as a placeholder ("query `select id from public.agents limit 2`") but Phase 1's real-script test path used `axel` literally — no harm, just clarity for next time.

3. **No `supabase link`.** `supabase db push` failed with "Cannot find project ref." Fell back to MCP `apply_migration` per plan's own footnote. Worked fine. If the goal is CLI-first, someone needs to `supabase link --project-ref obizmgugsqirmnjpirnh` once.

4. **`CRON_SECRET` not in `dashboard/.env.local`.** The cron handler returns 401 correctly, but full HTTP-path verification couldn't run end-to-end without restarting the dev server with a fresh env. Verified the underlying logic via `tsx` direct calls instead — `triageCapture` + `fileTriageProposal` returned a real LLM disposition, and the unique-index idempotency check passed (second insert returned `null`).

5. **`npx tsx --env-file` silently skips vars set empty in shell.** Hit the `dotenv override` gotcha (already in memory). `unset ANTHROPIC_API_KEY` before `npx tsx --env-file=.env.local …` was the workaround. The `dev` script in `package.json` uses `env -u ANTHROPIC_API_KEY` for the same reason — Node's `--env-file` does not override.

6. **Pre-existing lint state: 789 errors, 5,892 warnings.** The plan said "Both clean" for build + lint after every phase. Build was clean every time. Lint was clean *for the files I touched* (no new errors), but the codebase as a whole is far from clean. I treated "clean" as "no new errors in touched files" — flag if you want a stricter reading.

7. **Phase 4 card UI scope crept slightly.** I added `triage_capture`, `new_skill`, `pattern_observation`, and `workspace_item` body-preview branches to `proposal-card.tsx` in Phase 4 rather than splitting them across phases — keeps the card consistent and avoids touching the same file in 3 commits.

## Loose ends (file as `[loose-end]`)

These came from the plan's own loose-end list, plus what surfaced during execution:

- **Disk-write for `new_skill` proposals.** The legacy `/api/promotions` route runs `promote-skill.mjs` after inserting a `skill_versions` row. The new arm in `/api/promotions/proposal` deliberately skips disk write. Wire this in next pass.
- **`/api/tasks` POST still trusts `fromAgent` from request JSON.** Phase 1 added an existence check (so a bogus ID is rejected), but a malicious caller can still impersonate a real agent ID. Full fix: bind `fromAgent` to authenticated server context.
- **`CRON_SECRET` must be set in production env vars.** Vercel cron will fail-fast with 401 until then.
- **Triage idempotency index covers `status='proposed'` only.** Once a proposal is rejected, that capture can't be re-triaged. Acceptable for now.
- **`update_sop` proposal kind:** out of scope, deferred.
- ~~**🚨 Triage cron does not actually run.**~~ **Resolved 2026-05-04:** dropped the cron entirely. Triage is now an on-demand "Sort inbox" button on `/today`. Reasoning: dashboard is local-only (no Vercel), and Edmund's capture rate doesn't justify a scheduler. Endpoint at `POST /api/triage/run` (no auth — same-origin local only). Old `/api/cron/triage-captures` route deleted; matching `vercel.json` entry removed.
- **`work_log_task_completion_uniq` indexes `artifacts->0`** — fragile if a future code path ever appends multiple artifacts to a completion row.

## Files changed (in `dashboard/`)

```
app/api/cron/triage-captures/route.ts        (new)
app/api/promotions/proposal/route.ts         (+ triage_capture, new_skill, pattern_observation, workspace_item arms; idempotency early-return)
app/api/today/route.ts                        (new)
app/inbox/promotions/proposal-card.tsx       (4 new body-preview branches; widened ProposalRow.kind)
app/today/page.tsx                            (new)
app/today/today-client.tsx                    (new)
components/layout/sidebar.tsx                 (Today nav entry)
CLAUDE.md                                     (corrected workspace-storage claim)
lib/icons.ts                                  (Sun export)
lib/task-completion.ts                        (new)
lib/task-inbox.ts                             (agent-id assertion; recordTaskCompletion hook)
lib/today.ts                                  (new)
lib/triage.ts                                 (new)
lib/tools.ts                                  (propose_skill, propose_pattern; gated workspace_item branch)
supabase/migrations/20260503100000_work_loop_today_view.sql   (new)
supabase/migrations/20260503110000_work_log_completion_unique.sql   (new)
supabase/migrations/20260503120000_proposals_triage_unique.sql      (new)
supabase/migrations/20260503120100_proposals_kind_check_widen.sql   (new — added during execution)
vercel.json                                   (triage-captures cron)
```

## Self-review checklist (from plan)

- [x] All 6 phases shipped, each with a real verification (not raw-SQL bypass).
- [x] No placeholders / TODOs in the code.
- [x] Migrations are idempotent (`create or replace`, `if not exists`, `drop constraint if exists`).
- [x] Two unique partial indexes exist: `work_log_task_completion_uniq`, `proposals_triage_capture_uniq`.
- [x] `materialized_target_id` left null when materializing into `agent_tasks` (text id).
- [x] `dashboard/CLAUDE.md` corrected.
- [x] Cron secret read from `process.env.CRON_SECRET` (not hardcoded).
- [x] `npm run build` clean after every phase.
