# Agent verification tests — 2026-04-18

**Source of tests:** Instructions supplied in the W7 verification dispatch (the referenced `2026-04-18-agent-verification-recon.md` was not found on disk; proceeded with the four ready-to-execute tests as written).
**Supabase:** `obizmgugsqirmnjpirnh`.
**Preview server:** `fb2a6095-e272-4348-acdc-7e7ac1a0abf6` (port 3000).
**Run window:** 2026-04-18 13:16–13:18 UTC.

---

## Test 1 — Slack end-to-end (validates A + part of C) — **PASS**

Posted to `POST /api/slack` with `channel="general"`, `agent="human"`, content `[TEST-W7-VERIFY] @cordis ping …`.

**Evidence:**
- Row landed in `slack_messages` (id `9ee6f0e6-…`), `mentions=["cordis"]`, `type="message"`.
- Server log: `[wake-up] Waking cordis from @mention in #general` → `[wake-up] cordis completed in 13739ms (3 tool calls)`.
- `agent_run_logs`: `cordis` / `completed` / `tool_calls=["read_slack_channel","post_slack_message","update_memory"]`.
- Cordis posted back: `"🤖 [TEST-W7-VERIFY] Cordis here — ping received and acknowledged. Verification check passed. Standing by."` (id `3d78de2a-…`, 7s after trigger).

Wake-up path, name→id resolution (`cordis` → `cordis`), tool loop, and Slack reply all confirmed working live.

---

## Test 2 — Task creation + Tokamak approval flow (validates B + F) — **PASS**

Inserted `pending_approval` task via SQL (`cordis` → `developer`, title `[TEST-W7-VERIFY] ping task`, priority 1 — note: `agent_tasks.priority` is `integer`, NOT text, so the spec's `priority='low'` would have failed). Approved via real `POST /api/tasks/approve`.

**Evidence:**
- `GET /api/tasks/approve` listed the task before approval.
- `/tasks` page snapshot showed the card with title, sender (Cordis → developer), P1, description.
- `POST /api/tasks/approve` returned `status: "approved", approvedBy: "human"`.
- Slack row auto-posted by approve handler: `"Approved task for @developer: \"[TEST-W7-VERIFY] ping task\""`, `mentions=["developer"]`, `type="task"`.
- Server log: `[wake-up] Waking developer — human approved task: "[TEST-W7-VERIFY] ping task"`.
- Developer (Axel) ran, called `complete_task`, posted: `"Completed task: \"[TEST-W7-VERIFY] ping task\" — Ping received and acknowledged. Axel is online and responsive. Task approval pipeline verified end-to-end."`
- Task row in DB ended at `status="completed"` with the result string attached.

End-to-end: create → pending → human approve → Slack notify → agent wake → agent completes task — all pass.

---

## Test 3 — Cooldown/concurrency guards (validates C edge case) — **PASS**

Fired 4 parallel `POST /api/slack` calls mentioning `@corva` (canonical id `content`) within ~170 ms.

**Evidence (server logs):**
```
[wake-up] Waking corva from @mention in #general  (x4, one per POST)
[wake-up] corva skipped in 213ms (0 tool calls)
[wake-up] corva skipped in 215ms (0 tool calls)
[wake-up] corva skipped in 237ms (0 tool calls)
[wake-up] corva completed in 7689ms (1 tool calls)
```
- `agent_run_logs` shows exactly 1 `content` completion at `13:17:48`.
- Corva posted one consolidated reply acknowledging "rapid-fire 1, 2, 3, and 4" (id `0a26fe7a-…`).
- 1 run vs 4 mentions = concurrency cap (`MAX_CONCURRENT`/`runningAgents` lock inside `wakeUpAgent`) caught 3 duplicates.

**Minor finding (not a bug):** the route-level `canRunAgent` call in `app/api/slack/route.ts` uses the raw `@mention` string before canonical resolution. `agentCooldowns` and `runningAgents` key on the canonical id. This makes the route-level check effectively a no-op for name-form mentions — but the `wakeUpAgent` re-check catches everything, so behavior is correct. Recommend tightening (resolve first, then check).

The 30s cooldown itself wasn't exercised — concurrency caught the duplicates first because all 4 arrived during the first run.

---

## Test 4 — Doc sync spot-check (validates D) — **FAIL (gap confirmed) → PASS post-sync** (see re-run below)

Compared disk CLAUDE.md vs `agents.claude_md` for `pm`, `content`, `research`.

| Agent | Disk bytes | DB `md_len` | Disk has "Canonical SQL" | DB has "Canonical SQL" | Disk has "Rebuild 2026-04-17 extensions" | DB has same |
|-------|-----------:|------------:|:---:|:---:|:---:|:---:|
| pm (Kardia) | 8,769 | 3,136 | Yes | **No** | Yes | **No** |
| content (Corva) | 6,529 | 4,231 | — | No | Yes | **No** |
| research (Feynman) | 2,537 | 2,537 | — | No | — | No |

Kardia's DB copy is **5,633 chars shorter** than disk — the entire W7.2d Rebuild extensions block (including the new Canonical SQL subsection with the three verbatim SQL snippets) is missing from DB. Corva's DB is **2,298 chars shorter**. Feynman matches (probably never had the Rebuild extensions added, or disk was also never updated).

**Runtime impact:** confirmed by reading `lib/agents.ts` — `getAgent()` reads `agents.claude_md` from Supabase, not from disk. So every live agent run (Tests 1–3 included) uses the **stale DB** system prompt. The W7.2d update does not affect runtime behavior today.

**Per instructions — not fixed. This is a separate epic.**

---

## Test 4 — RE-RUN post-sync (validates D) — **PASS**

**Run window:** 2026-04-18 ~13:22 UTC (after `node --env-file=.env.local scripts/import-agents-from-icloud.mjs` upserted all 8 agents).

**Disk side (grep for markers):**

| Agent | Disk has "Rebuild 2026-04-17 extensions" | Disk has "Canonical SQL" |
|---|:---:|:---:|
| pm (Kardia) | yes (line 66) | yes (line 101) |
| content (Corva) | yes (line 69) | — (not expected) |
| research (Feynman) | yes (line 60) | — (not expected) |

**DB side (`SELECT id, length(claude_md), has_rebuild, has_canonical_sql, updated_at FROM agents WHERE id IN ('pm','content','research')`):**

| id | db_len | has_rebuild | has_canonical_sql | updated_at |
|---|---:|:---:|:---:|---|
| content | 6,477 | true | false | 2026-04-18 13:21:38 UTC |
| pm | 8,701 | true | true | 2026-04-18 13:21:38 UTC |
| research | 4,695 | true | false | 2026-04-18 13:21:38 UTC |

**Deltas from the original Test 4 DB snapshot:**

| Agent | DB len before | DB len after | Δ |
|---|---:|---:|---:|
| content | 4,231 | 6,477 | **+2,246** |
| pm | 3,136 | 8,701 | **+5,565** |
| research | 2,537 | 4,695 | **+2,158** |

All three Rebuild extension blocks now live in Supabase. Kardia's DB copy contains the Canonical SQL subsection (3 snippets) from W7.2d verbatim. Runtime agent sessions now serve the updated system prompts — the W7.2d update takes effect immediately.

**Fix mechanism:** one-shot `dashboard/scripts/import-agents-from-icloud.mjs --dry` (verified parse output) then a live run. Idempotent via `upsert ... ON CONFLICT id DO UPDATE`. No schema changes, no new migrations. The gap is closed; the underlying lack of an automated sync pipeline remains (flagged as Priority #1 for next run).

---

## Overall system status (reconciled)

| Area | Recon-style letter | Status from tests |
|---|---|---|
| A. Slack ingest → mention extraction → row persist | A | **Green** — rows land, mentions parsed correctly, UUIDs generated. |
| B. Task create + approval + agent wake on approval | B | **Green** — full create→pending→approve→wake→complete chain passes live. |
| C. Wake-up path (cooldown + concurrency guards) | C | **Green for concurrency**; cooldown not directly exercised but code path looks correct. Minor polish: route-level `canRunAgent` should resolve name → canonical id before checking. |
| D. Doc sync disk → `agents.claude_md` | D | **Green post-sync** — import script run successfully in this session; all three Rebuild extensions now in DB. Automated sync pipeline still missing (manual re-run required after disk edits) — flagged as Priority #1 for next run. |
| F. Tokamak approval Slack notification | F | **Green** — approval posts a `type=task` message with the right `mentions` array. |

---

## Priority fixes (top 3 for next run)

1. **Automate doc sync** *(S, 45 min)*. Existing one-shot script at `dashboard/scripts/import-agents-from-icloud.mjs` works but is manual. Wrap in a `POST /api/admin/sync-agents` endpoint + sidebar "Sync agents from iCloud" button for one-click refresh. Long-term option: file-watcher or scheduled 5-min pull so disk edits propagate automatically.
2. **Tool tag filtering** *(S, ~30 min)*. Master roster declares per-agent tool tags but `lib/anthropic.ts:145` and `lib/agent-runner.ts:178` hand every agent the full `FILE_TOOLS ∪ WORKSPACE_TOOLS ∪ COMMUNICATION_TOOLS` set. Hild can `write_file`; Axel can `post_to_slack`. Filter by agent's declared tags before constructing the tools array. Closes Ask E.
3. **Resolve mention before route-level `canRunAgent` check** *(S, ~15 min)*. In `dashboard/app/api/slack/route.ts` (and `tasks/approve/route.ts`), `await resolveAgentId(agentId)` first, then check `canRunAgent(canonicalId)`. Avoids the silent miss on name-form mentions; also gives a clean skip-reason log at the route level.
4. **Sidebar merge conflict hygiene** *(XS, ~5 min)*. Prior run-log mentioned a `>>>>>>> Stashed changes` marker at `components/layout/sidebar.tsx:40`; spot-check during this session's W7.2c commit confirmed the file is now clean. Keep this one closed.

---

## Cleanup confirmation

```sql
SELECT
  (SELECT count(*) FROM slack_messages WHERE content LIKE '%[TEST-W7-VERIFY]%') AS slack_remaining,
  (SELECT count(*) FROM agent_tasks      WHERE title   LIKE '[TEST-W7-VERIFY]%') AS tasks_remaining,
  (SELECT count(*) FROM agent_run_logs   WHERE started_at >= '2026-04-18 13:16:00+00') AS run_logs_remaining;
-- result: slack_remaining=0, tasks_remaining=0, run_logs_remaining=0
```

All `[TEST-W7-VERIFY]` rows purged from `slack_messages` and `agent_tasks`; the three `agent_run_logs` rows created during the test window were also deleted so the verification run leaves zero state behind.
