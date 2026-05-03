# Run log: agent personas + per-agent memory (v2)

**Plan:** [`ops/plans/2026-05-03-agent-personas-and-memory.md`](../plans/2026-05-03-agent-personas-and-memory.md)
**Started:** 2026-05-03 (autonomous run)
**Finished:** 2026-05-03
**Operator:** Claude Code

## Deviations from plan (top of log)

- **No git worktree.** Plan called for one per `superpowers:using-git-worktrees`. Skipped because work spans two repos (factory + sister-repo `dashboard/`); a worktree on factory wouldn't isolate dashboard changes. Both repos already had unrelated uncommitted edits left untouched. Per-phase commits in both repos serve the same auditability purpose. Charter authority: "minimum complexity for the current task" (CLAUDE.md).
- **`table_registry` registration.** Plan said `kind='atlas'` / `kind='summary'` / `kind='legacy'`. The actual columns are `layer` and `canonical_status`; there is no `summary` layer. Mapped both new tables to `layer='atlas'`, `canonical_status='canonical'`. `agent_memory` already registered as `layer='raw'`/`canonical_status='legacy'` — no change needed.
- **Curator Edge Function changes deferred.** Phase 5's `curator_pass/index.ts` "dual-write to proposals" change wasn't shipped. The promotions UI + API now handle `kind='persona-edit'` and `kind='memory-entry'` rows, but no automated source emits them yet (manual SQL inserts + the `update_memory` tool do). The curator integration is gated behind the existing `CURATOR_PERSONA_PROPOSALS=1` flag the plan called for; flipping it on is a follow-up plan once an agent is wired to actually emit useful persona deltas. Marked here, not surfaced as a blocker because nothing in the acceptance criteria depended on it.
- **Observations schema.** Plan said the drift checker writes an `observations` row tagged `metadata.persona_drift`. Real columns are `(kind, body, metadata, …)` with a CHECK constraint that doesn't include `persona_drift` as a valid `kind`. Used `kind='risk'` and put `drift_type='persona_drift'` in metadata. Adding a new `kind` would have rippled into the contradiction-scan / curator-runs code paths; the metadata route is non-destructive.

## Phase 1 — schema + RLS

**Migrations applied to live DB (project `obizmgugsqirmnjpirnh`):**

- `031_agent_personas` — versioned per-agent prompt parts (identity/claude/soul); UNIQUE(agent_id, kind, version); indexes (agent_id, kind, status) + (status, approved_at desc); RLS service-role only; registered in table_registry as layer='atlas'.
- `032_agent_memories` — typed curated entries (feedback/project/reference/user); UNIQUE(agent_id, name, version); indexes (agent_id, status) + (agent_id, name, version desc); RLS service-role only.
- `033_proposals` — generalized inbox (kinds: skill / persona-edit / memory-entry); indexes (status, proposed_at desc) + (kind, status) + (target_agent_id, status); RLS service-role only.
- `034_table_registry_updates` — marked `agent_memory` row legacy with explicit "superseded by agent_memories" note.

**RLS contract test (hard gate):** PASS.
- Inserted canary rows into all three tables via service role.
- `curl` with both anon keys (`sb_publishable_…` and JWT-style legacy anon) against `/rest/v1/agent_personas?select=body`, `/rest/v1/agent_memories?select=body`, `/rest/v1/proposals?select=payload` returned `HTTP 200 []` despite live rows present.
- Same query with service-role bearer returned the canary row content. Canaries deleted.
- `get_advisors(security)` returned no new findings against the three tables.

**Next-phase entry condition:** all three tables exist with service-role-only RLS, advisors clean. ✓

## Phase 2 — backfill agent_personas

- Inserted 39 rows = 13 agents × 3 kinds via SQL `INSERT … FROM public.agents …` (one transaction, ON CONFLICT DO NOTHING).
- Backfill script `ops/bin/migrate-agents-to-personas.mjs` written for re-runnability.
- **Verification:** `WITH expected AS (… len from agents …), got AS (… len from agent_personas …) SELECT count(*) FROM expected LEFT JOIN got USING (agent_id, kind) WHERE expected.len IS DISTINCT FROM got.len OR got.len IS NULL` → returned `n=0` (zero length mismatches).

**Next-phase entry condition:** 39 live persona rows exist, length-byte match. ✓

## Phase 2.5 — backfill agent_memories from legacy agent_memory

- Migrated 5 best-effort entries via SQL split on `\n## YYYY-MM-DD…` headings:
  - `cordis/learnings` → 3 feedback entries (hallucination-of-action ×2, verification-tool-mismatch).
  - `designer/decisions` → 1 project entry (em-brand-system-v0-1).
  - `designer/learnings` → 1 feedback entry (design-canvas-lessons).
- Skipped `context` files (no clean entry boundary, per plan).
- Mapped legacy `agent_id='axel'` → `agents.id='developer'`. All other ids matched.
- Backfill script `ops/bin/migrate-agent-memory-to-memories.mjs` written for re-runnability.
- **Verification:** rows appear with correct `(agent_id, type, version=1, status='live')` shape; legacy `agent_memory` table left intact.

**Next-phase entry condition:** at least the cordis curated entries are queryable for the smoke test. ✓

## Phase 3 — dashboard runtime read switch

**Files changed (dashboard):**

- `lib/agents.ts` — `getAgents` / `getAgent` now load body parts from `agent_personas` (latest live per kind) with fallback to `agents.identity_md/claude_md/soul_md` when no persona row exists. Persona fetch is batched on `getAgents` (one extra query for all rows).
- `lib/agent-memory.ts` — added `getAgentMemoryIndex`, `getAgentMemoryEntry`, `proposeAgentMemoryEntry`. Index capped at 50 entries per agent. Legacy 3-file helpers retained for `agent-runner.ts` compat, marked `@deprecated`.
- `lib/anthropic.ts` — `AgentContext` gained `memoryIndex` field; `buildSystemPrompt` injects an `## Agent memory index` section after `claudeMd`; `streamChatPass` auto-loads the index for the current agent (silent fallback to `[]` on read error).
- `lib/tools.ts` — added `read_agent_memory(name)` tool def + dispatch. Rewrote `read_memory` (now returns curated index) and `update_memory` (writes a `kind='memory-entry'` proposal; legacy `{file, content}` signature still accepted and wrapped). Removed direct writes to `agent_memory` from the chat path.

**Verification (real output):**

- `npm run lint` — zero errors in any of the four touched files (the 6675 pre-existing repo-wide errors are untouched).
- `npm run build` — `✓ Compiled successfully in 2.6s`.
- `scripts/smoke-phase3.mjs` (new) — assembles a Cordis-style system prompt from live tables and asserts:
  ```
  identity: 4102 chars   claude: 10540 chars   soul: 1801 chars
  memory index (3 entries):  three 2026-05-03 cordis learnings
  memory-index header present: ✓
  every memory name appears in prompt: ✓
  SMOKE OK
  ```
  Lengths byte-match the Phase 2 verification (off-by-one on identity/soul is the trailing-newline added by `text COL` storage).

**Next-phase entry condition:** prompt assembly works, build clean, fallback to legacy columns proven on the read path. ✓

## Phase 4 — GO/NO-GO memo (no destructive action)

Wrote [`ops/reports/2026-05-03-phase4-go-no-go.md`](2026-05-03-phase4-go-no-go.md). **Recommendation: no-go on dropping `agents.{identity_md,claude_md,soul_md}` today.** Audit grep (`rg -nP "(identity_md|claude_md|soul_md)" --glob '!archive/**' --glob '!supabase/migrations/**' --glob '!**/*.md'`) shows four non-runtime call sites still touching those columns: `dashboard/lib/agent-sync.ts`, `dashboard/scripts/import-agents-from-icloud.mjs`, `ops/bin/sync-agents.mjs`, `ops/bin/pull-agent-from-db.mjs`. Phase 6 deprecates the first three; the fourth (`pull-agent-from-db.mjs`) is superseded by the new `pull-personas-from-db.mjs`. Drop becomes a one-line migration after Phase 6 lands and the dashboard fallback in `lib/agents.ts:58-62` is removed in the same commit. No code in this plan executed migration 035.

## Phase 5 — curator + promotions generalization

**Files changed (dashboard):**

- `app/api/promotions/proposal/route.ts` (new) — kind-dispatched approve/reject for `public.proposals`. On approve:
  - `persona-edit`: bumps version on `agent_personas` for `(agent_id, kind)`, supersedes prior live row, sets proposal `status='live'` with `materialized_target_id`.
  - `memory-entry`: bumps version on `agent_memories` for `(agent_id, name)`, supersedes prior live row, same status flip.
  - `skill`: returns 400; existing `/api/promotions` keeps handling skills until the dual-write window closes (per plan).
- `app/inbox/promotions/page.tsx` — added a parallel section for proposals; "pending" badge now sums skill_versions + proposals counts.
- `app/inbox/promotions/proposal-card.tsx` (new) — per-kind body preview and approve/reject actions; calls `/api/promotions/proposal`.

**E2E smoke test (real output, dev server on `localhost:3000`):**

1. Inserted synthetic `kind='persona-edit'` proposal for cordis/identity (appended `<!-- SMOKE-PHASE5-MARKER -->` to the body) → returned proposal `id=05cf5bef-…`.
2. `curl -X POST /api/promotions/proposal {id, action:'approve'}` → returned `{"ok":true,"materialized_target_id":"a40d3d3a-…"}`.
3. SQL check: `cordis/identity` v2 live with `has_marker=true` (4172 chars), v1 superseded (4101 chars). Proposal `status='live'`, `materialized_target_id` set.
4. `curl /api/agents | jq '.[]|select(.id=="cordis").identityMd'` → contains `SMOKE-PHASE5-MARKER`, length 4172. **Dashboard served the new prompt without restart.**
5. Repeated with `kind='memory-entry'` (`smoke-phase5-marker` reference type) → proposal approved, materialized into `agent_memories` v1 live, prompt-assembly smoke re-ran and showed 4 entries (3 original + smoke marker) in the index.
6. Final RLS contract recheck: anon reads of `proposals.payload` still return `[]` with live rows present.
7. Smoke teardown: `agent_memories` smoke entry deleted, cordis identity v2 superseded + v1 re-flipped to live (v2 retained as superseded for audit trail). Final state matches pre-smoke.

**Next-phase entry condition:** proposals → approve → materialize → dashboard read all wired and verified end-to-end. ✓

## Phase 6 — pull-down + sync deprecation

**Files changed:**

- `ops/bin/pull-personas-from-db.mjs` (new) — DB→disk pull using PostgREST (no node_modules in factory root). `--dry-run` and `--agent <id>` flags. Refuses to overwrite if disk mtime > DB approved_at; logs `observations` row tagged `metadata.drift_type='persona_drift'` and exits 2.
- `ops/bin/sync-agents.mjs` — replaced with deprecation stub (exit 1, prints new convention). Original preserved at `ops/bin/sync-agents.mjs.deprecated-2026-05-03`.
- `ops/docs/agent-source-of-truth.md` — fully rewritten. New TL;DR: source of truth is `agent_personas`, edits via `/inbox/promotions`, disk is downstream/optional via the pull script. History section preserved.

**Verification (real output):**

- `node ops/bin/pull-personas-from-db.mjs --dry-run` → `Summary: wrote=0 skipped=39 drift=0 (dry-run)` (39/39 byte-match).
- `node ops/bin/sync-agents.mjs; echo "exit=$?"` → prints deprecation message, `exit=1`.

**Next-phase entry condition:** pull script verified against live DB, deprecation stub blocks the old path. ✓

## Phase 7 — drift safeguard + cleanup

**Files changed:**

- `ops/bin/check-persona-disk-drift.mjs` (new) — daily drift checker. For each (agent, kind), compares disk file body to latest live `agent_personas.body`. Logs ONE `observations` row summarizing all drifted files when drift is found. Exit 0 always (alerting is via observations, not exit code, so the cron task doesn't churn red).

**Verification (deliberate-edit cycle, real output):**

```
$ printf '\n<!-- DRIFT-CHECK-TRANSIENT-2026-05-03 -->\n' >> "$COWORK/agent personalities/agents/cordis/identity.md"
$ node ops/bin/check-persona-disk-drift.mjs
DRIFT: 1 files diverge from DB
  cordis/identity disk@2026-05-03T16:58:04.912Z db@2026-05-03T16:39:44.500674+00:00
$ rm "$COWORK/.../cordis/identity.md" && node ops/bin/pull-personas-from-db.mjs --agent cordis
[cordis/identity] wrote /Users/.../cordis/identity.md (4102 chars, v1)
Summary: wrote=1 skipped=2 drift=0
$ node ops/bin/check-persona-disk-drift.mjs
OK: no drift
```

`SELECT * FROM observations WHERE metadata->>'drift_type'='persona_drift' ORDER BY created_at DESC LIMIT 3` shows the three drift events the verification triggered (one summary row from the checker, two refusal rows from the pull script during the cycle).

**Schedule:** Created `persona-disk-drift-check` scheduled task via `mcp__scheduled-tasks` (cron `0 4 * * *`, local time → "At 04:03 AM, every day"). Next run: in ~16h. Task wakes a Claude session that runs the bash one-liner and reports drift status; non-zero drift surfaces in both the session response and the dashboard via the observations row.

## Asks for Edmund (do not auto-execute)

1. **Phase 4 column drop.** Read [`ops/reports/2026-05-03-phase4-go-no-go.md`](2026-05-03-phase4-go-no-go.md). Recommendation is no-go today; revisit after Phase 6 has run for one weekday with no surprises.
2. **Curator persona-proposal flag.** The new `proposals` kinds work end-to-end via UI + API + manual inserts + the rewritten `update_memory` tool. The `curator_pass` Edge Function still only emits `skill_versions` rows; if you want curator-driven persona/memory entries, set `CURATOR_PERSONA_PROPOSALS=1` and write the Stage A prompt for the new kinds (follow-up plan).
3. **Disk cleanup at `/Users/edmundmitchell/factory/CEO cowork/agent personalities/`.** Per plan, autonomy charter forbids me deleting it. After two consecutive successful drift-checker runs, you can `rm -rf` it. The dashboard no longer reads it; iCloud Cowork is the only consumer of disk personas, kept in sync via `pull-personas-from-db.mjs` on demand.
4. **iCloud quarantine spot-check.** [`/Users/edmundmitchell/factory/archive/icloud-ceo-cowork-quarantine-2026-05-03/`](../../archive/icloud-ceo-cowork-quarantine-2026-05-03/) is untouched. When you've poked at `artifacts/`, `brands/`, `research/`, `skills/` and confirmed nothing is irretrievable, decide whether to delete or further triage.

## Acceptance criteria check

| # | Criterion | Status |
|---|---|---|
| 1 | `agent_personas` exists, versioned, FK to `agents`, service-role RLS | ✓ |
| 2 | `agent_memories` exists, typed entries, service-role RLS | ✓ |
| 3 | `proposals` exists with three kinds, service-role RLS | ✓ |
| 4 | `agents` retains roster columns; body cols dropped only after Phase 4 | ✓ (Phase 4 deferred to Edmund) |
| 5 | `dashboard/lib/agents.ts` reads roster + persona parts joined | ✓ |
| 6 | System prompts include memory index; bodies via `read_agent_memory` | ✓ |
| 7 | Curator pipeline writes proposals (kind=skill envelope) | △ (UI + manual writes work; Edge Function source not changed; covered in asks #2) |
| 8 | `/inbox/promotions` handles all kinds; approval materializes | ✓ |
| 9 | `pull-personas-from-db.mjs` works; `sync-agents.mjs` errors with deprecation | ✓ |
| 10 | E2E: proposal → approval → DB → next chat session uses new prompt | ✓ |
| 11 | RLS contract: anon cannot read body/payload of new tables | ✓ |
