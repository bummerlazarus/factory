# Phase 4 GO/NO-GO memo — drop `public.agents.{identity_md,claude_md,soul_md}`

**Status:** awaiting Edmund decision (autonomy-charter hard-stop).
**Audit timestamp:** 2026-05-03, after Phases 1–3 shipped.

## Recommendation

**No-go on the column drop today.** Phase 6's deprecation of the disk→DB push path needs to land first. Re-run this audit after Phase 6 ships and the `pull-agent-from-db.mjs` consumer is rewritten on top of `agent_personas`. Once those land, the drop becomes a one-line migration with zero call-site fallout.

## Why

The runtime read path is already safe:

- `dashboard/lib/agents.ts` reads from `public.agent_personas` first and only falls back to the body columns if no live persona row exists. With 39/39 live persona rows seeded, the fallback never fires in practice today.

But four non-runtime call sites still touch the body columns. None of them break the dashboard, but they stop working the moment the columns drop:

| File | What it does | Action needed before drop |
|---|---|---|
| [dashboard/lib/agent-sync.ts](../../dashboard/lib/agent-sync.ts) | Disk→DB push (writer) | Phase 6 deprecates this path. Replace with proposal flow. |
| [dashboard/scripts/import-agents-from-icloud.mjs](../../dashboard/scripts/import-agents-from-icloud.mjs) | Historical one-shot iCloud import (writer) | Delete or no-op; superseded by migration 031 + persona backfill. |
| [ops/bin/sync-agents.mjs](../../ops/bin/sync-agents.mjs) | Disk→DB push CLI (reader+writer) | Phase 6 replaces with deprecation stub; safe to drop. |
| [ops/bin/pull-agent-from-db.mjs](../../ops/bin/pull-agent-from-db.mjs) | DB→disk single-agent recovery (reader) | Phase 6 supersedes with `pull-personas-from-db.mjs`; this script can then be deleted. |

The dashboard fallback in `agents.ts:58-62` is intentional belt-and-suspenders for the transition. After the drop, that fallback should be removed in the same commit (it would always read `null`).

## Verifications already done

- 39/39 live persona rows exist (3 per agent × 13 agents).
- Length-byte match between `agents.{identity_md,claude_md,soul_md}` and the corresponding `agent_personas.body` rows passed (zero mismatches).
- RLS contract test passed: anon role cannot read `agent_personas.body`, `agent_memories.body`, or `proposals.payload`.
- Dashboard build is clean with the new read path.

## When to call Phase 4

After Phase 6 ships and one weekday passes with no production reports of the legacy CLI being needed:

1. Re-run the audit grep:
   ```
   rg -nP "(identity_md|claude_md|soul_md)" --glob '!archive/**' --glob '!supabase/migrations/**' --glob '!**/*.md'
   ```
   Must show only `lib/agents.ts` (the fallback to be removed in the same commit).

2. Drop the fallback in `dashboard/lib/agents.ts`, then ship migration 035:
   ```sql
   ALTER TABLE public.agents
     DROP COLUMN identity_md,
     DROP COLUMN claude_md,
     DROP COLUMN soul_md;
   ```

3. Smoke: refresh the dashboard, start a chat with each of the 13 agents, confirm system prompts unchanged.

## Risks if dropped today

- `ops/bin/sync-agents.mjs` would 500 on its next invocation. (Phase 6 deprecates it explicitly — but until then, anything that runs the script from cron or a documented runbook breaks.)
- `pull-agent-from-db.mjs` recovery loses its only data source; emergency restore-from-DB stops working until the new pull script ships.
- The fallback in `agents.ts` would always be `null`, masking any future bug in the persona read path with a silent empty prompt.

## TL;DR

Phases 1–3 made the read path correct. Phase 6 will make the write path correct. The column drop is one trivial migration after that — not now.
