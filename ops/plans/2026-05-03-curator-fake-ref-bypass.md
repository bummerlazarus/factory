# curator_pass — close the fake-reference bypass (rev 1)

**Date:** 2026-05-03
**Author:** Claude (with Edmund)
**Status:** proposed (follow-up to ops/plans/2026-05-03-cost-routing.md)

## Problem

After the 2026-05-03 cost-routing change, `curator_pass` is two-stage:
- Stage A (Haiku) drafts proposals from raw `work_log` / `ingest_runs` / `agent_conversations`.
- Stage B (Sonnet) reviews drafts against an explicit ID allow-list.

Codex review flagged a real gap (`supabase/functions/curator_pass/index.ts:343`): Sonnet only sees the **list of valid IDs**, not their content. A draft can cite a real `work_log` id whose actual content has nothing to do with the proposal's claim. Sonnet has no way to detect the mismatch, and the deterministic post-check only verifies the id is real. Result: a hallucinated rationale can ride a real id through both gates and into `skill_versions` (status `proposed` — Edmund still sees it before promotion, so blast radius is bounded, but quality goes down).

## Goal

Make Sonnet able to verify "does the cited row actually support this rationale?" without ballooning the prompt or losing the cost win.

## Out of scope

- Stage A / Stage B model changes (Haiku-drafts → Sonnet-reviews stays).
- Dry-run semantics, persistence, allowlist guard, env override behavior — all unchanged.
- Schema changes to `curator_runs`, `skill_versions`.

## Approach (proposed)

Pass **short evidence snippets** alongside the ID allow-list to the review pass. Index by id so the reviewer can match claim → content.

### Stage A change (none structural — just an output contract reminder)
No code change. Draft output already cites ids; we use the source rows we already fetched.

### Stage B prompt change (`curator_pass/index.ts`, review user prompt)

Today the review user prompt includes:
```
valid_work_log_ids: [...]
valid_ingest_run_ids: [...]
valid_session_ids: [...]
```

Replace with a richer evidence map keyed by id:

```
## Evidence map (id → short snippet)
work_log:
  <id>: <kind> | <project> | <summary, truncated to 240 chars>
  ...
ingest_runs:
  <id>: <source_type> | <source_title> | status=<status>
  ...
sessions:
  <id>: <persona_id> | <title>
  ...
```

Truncation rules (in code):
- `work_log.summary`: `slice(0, 240)`. If null, use `kind` only.
- `ingest_runs.source_title`: `slice(0, 200)`.
- `agent_conversations.title`: `slice(0, 200)`.
- Cap total evidence map size at **8 KB** of text. If we'd exceed, drop the oldest rows from the map (still keep them in the id allow-list — they just don't get evidence). Note this in the prompt: *"If a cited id is in the allow-list but missing from the evidence map, treat it as untrusted and drop the proposal."*

### Stage B prompt copy add

Add to the system prompt:
> For each proposal, verify the rationale is *supported by* the actual content of cited evidence rows. If a cited row's snippet does not plausibly support the claim, DROP the proposal. Mismatches are the most common failure mode — be strict.

### Deterministic check (Stage C) — unchanged

Still validates: `skill_name` kebab-case, body/rationale non-empty, ≥1 source_ref, every cited id is in the allow-list. We do NOT add a code-side semantic check (would require its own LLM call — defeats the cost saving).

## Token / cost impact

- Today's review prompt: ~draft proposals (≤3, each ≤4KB) + id arrays (~50 ids × 36 chars ≈ 2KB) + skill names ≈ **5-15 KB input**.
- After change: + evidence map up to 8 KB → **13-23 KB input**.
- Sonnet pricing at ~$3/MTok input: extra ~$0.05 per run × 1 run/day = **~$1.50/mo**. Negligible vs. the $150-300/mo win.

## Acceptance criteria

- [ ] Stage B user prompt contains an evidence map keyed by id with truncated content for `work_log`, `ingest_runs`, and `agent_conversations`.
- [ ] Total evidence map ≤ 8 KB; oldest rows dropped if needed.
- [ ] Stage B system prompt explicitly instructs reviewer to drop proposals where rationale doesn't match evidence.
- [ ] Deterministic check unchanged.
- [ ] `deno check` clean.
- [ ] Smoke test (`{"hours":24,"dry_run":true}`) returns 200 and the resulting `curator_runs.notes` shows the same `draft → reviewed → inserted` shape.
- [ ] Manual eyeball pass: at least one prior fake-cite case from the 2026-05-03 run no longer slips through (or, if no fake-cite case exists in recent data, manually craft one by inserting a synthetic draft in dev).
- [ ] Codex review on the diff before merge.

## Rollback

`git show HEAD~1:supabase/functions/curator_pass/index.ts` + redeploy via Supabase MCP `deploy_edge_function`. Per-function, not all-or-nothing. Same path as the cost-routing rollback.

## Files touched

- `supabase/functions/curator_pass/index.ts` (Stage B prompt expansion + bookkeeping for evidence map size)
- `ops/changelog.md` (one-paragraph entry)

## Open questions

1. **Evidence-map cap of 8 KB** — pulled from gut. If we see review-stage truncation actually drop important rows, raise to 16 KB and re-cost.
2. **`agent_conversations` body** — current select returns `title` only, not message content. Is the title alone enough signal? If not, this plan needs a second select that grabs the most recent ~3 messages per session, which doubles the network cost. Defer until we see misses.
3. **Should we also pass the active skill's *current body* to the reviewer for "update vs. new" proposals?** Not in this plan — extra prompt size, marginal win. Revisit if Edmund sees skill-update proposals that obviously contradict the existing body.
