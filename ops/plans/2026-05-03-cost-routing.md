# Cost-Routing via OpenRouter — Plan (rev 3)

**Date:** 2026-05-03
**Author:** Claude (drafted with Edmund)
**Goal:** Cut LLM spend by routing low-stakes Edge Function tasks to Haiku via OpenRouter while keeping Sonnet for tasks that need it. Estimated savings: $150–300/mo.
**Out of scope:** Main dashboard chat (`lib/anthropic.ts`), agent runner main loop, audio transcription, signal classification.

**Revision history:**
- rev 1 → rev 2 (2026-05-03): incorporated Codex review findings — keep OpenAI fallback, harden curator review pass, scope dashboard work to one file, drop nested codex review from autonomous prompt, add model allowlist guard.
- rev 2 → rev 3 (2026-05-03): Codex round 2 — fixed allowlist regex for Gemini, applied allowlist guard to caller-supplied `mixture.body.models`, added dedicated `"vote_mid"` task, scoped rollback path per repo, clarified commit/push branch policy, made `curator_runs.metadata` behavior explicit (inspect first, no migration).

---

## Approved model list (locked)

The plan uses ONLY these models. Any future change requires Edmund's approval.

| Tier | Model id (OpenRouter) | OpenAI fallback (when `OPENROUTER_API_KEY` missing) |
|---|---|---|
| cheap | `anthropic/claude-haiku-4-5` | `gpt-4o-mini` |
| mid | `anthropic/claude-sonnet-4-6` | `gpt-4o-mini` |
| strong | `anthropic/claude-opus-4-7` | `gpt-4o-mini` |

**Allowlist guard (enforced in `pickModel`):** if `MODEL_CHEAP` / `MODEL_MID` / `MODEL_STRONG` env vars are set, they MUST start with one of: `anthropic/`, `openai/`, `google/gemini-`. Any other prefix → `pickModel` throws and the Edge Function returns 500 with `model_id_disallowed`. Prevents a typo or env-var compromise from quietly routing to DeepSeek/Mistral/etc.

---

## Background

Audit (2026-05-03) found 3 Edge Functions (`curator_pass`, `delegate`, `mixture`) and the dashboard's `_shared/llm.ts` tier map are the easy-win surface. OpenRouter is already wired into all three Edge Functions. There is no centralized model picker — each call site hardcodes a model string.

Decisions locked this session:
1. `curator_pass` becomes two-stage: Haiku drafts (reads source data), Sonnet reviews (sees only draft + ID allow-list).
2. `mixture` voters → `[Haiku, Sonnet, Haiku]`; synthesizer stays Sonnet.
3. Phase 3 (dashboard chat cheap-mode toggle) skipped.
4. Keep existing OpenAI fallback in all three functions — do not remove.
5. Dashboard scope minimized to a single one-line tier change in `_shared/llm.ts`.

---

## Step 1 — Centralized model picker (factory only)

**New file:** `supabase/functions/_shared/models.ts`

Exports:
- `pickModel(task: Task): string` — returns a model id (OpenRouter form, `provider/model`)
- `assertAllowed(modelId: string): void` — validates a model id against the allowlist; throws `model_id_disallowed` on violation. Exported separately so callers (e.g. `mixture` body validation) can reuse the same guard.
- Type `Task = "summarize" | "classify" | "vote" | "vote_mid" | "audit_draft" | "synthesize" | "review" | "reason_hard"`

Implementation rules:
- Tier defaults are hardcoded constants in this file (see Approved model list above).
- Env var overrides: `MODEL_CHEAP`, `MODEL_MID`, `MODEL_STRONG`. If unset, defaults win.
- **Allowlist guard regex (correct form):** `/^(anthropic|openai)\/.+$|^google\/gemini-.+$/`. Matches any `anthropic/...`, any `openai/...`, and `google/gemini-*` only (not `google/gemini/...` or other Google models). Both env-var defaults AND any caller-supplied model id (Step 3) MUST pass this check. On violation, throw `Error('model_id_disallowed: <value>')`.
- Task → tier:
  - `summarize`, `classify`, `vote`, `audit_draft` → cheap
  - `vote_mid`, `synthesize`, `review` → mid
  - `reason_hard` → strong
- Also export `pickFallback(): string` returning the OpenAI fallback id (`gpt-4o-mini` for now). Callers use this when `OPENROUTER_API_KEY` is missing — single source of truth instead of inlining `gpt-4o-mini` in three files.

**No mirrored copy in dashboard.** Dashboard's existing `_shared/llm.ts` already has tier logic; we change one line there (Step 5) and call it done. Avoids duplication.

---

## Step 2 — Refactor `supabase/functions/curator_pass/index.ts` to two-stage

Current: one Sonnet call reads everything.

New flow:

### 2a. Draft pass (cheap tier, `pickModel("audit_draft")`)
- Receives the full work_log + ingest_runs + sessions + active skill names (current behavior).
- Returns the same JSON `{proposals: [...]}` shape.
- **Tighten the prompt for Haiku:** add an explicit example of the JSON shape and "If unsure, return `{\"proposals\": []}`. Empty is correct."
- **JSON validation + retry:** validate top-level shape `{proposals: Proposal[]}` (proposals must be an array, even if empty) AND row-level fields per 2c. If parse OR shape OR row validation fails, retry exactly once with a stricter "RETURN VALID JSON ONLY MATCHING `{\"proposals\": [...]}`. NO PROSE." prefix. If retry also fails, persist `curator_runs.status='error'` with the raw text, return 502.

### 2b. Review pass (mid tier, `pickModel("review")`)
- Receives:
  - The draft JSON (no source data)
  - **An explicit ID allow-list:** `valid_work_log_ids`, `valid_ingest_run_ids`, `valid_session_ids` arrays (extracted from the actual data the draft pass saw). Sonnet uses this to spot fake citations.
  - Active skill names (so it can flag skill_name conflicts)
- Prompt: "You are reviewing draft skill-update proposals from a junior agent. Tighten rationales. DROP any proposal whose source_refs cite an id NOT in the provided allow-lists. Drop weak/speculative proposals (zero is fine). Return the SAME JSON shape with the same schema."
- Same JSON validation + retry policy as draft pass.

### 2c. Schema validation (deterministic, in code)
Before inserting any reviewed proposal into `skill_versions`, validate each row:
- `skill_name` is non-empty, kebab-case
- `proposed_body_diff` is non-empty
- `rationale` is non-empty
- Every `source_refs[].id` exists in the corresponding allow-list (drop the proposal if not — log it in `curator_runs.notes`)

Drop invalid proposals silently (logged), do not insert.

### 2d. Persistence + logging
- Existing `skill_versions` insert logic unchanged after 2c filtering.
- `curator_runs.notes` records: `"draft: {n_draft} → reviewed: {n_review} → inserted: {n_inserted} (dropped {n_dropped} for {reasons})"`
- **Where to log model ids:** before writing, `SELECT column_name FROM information_schema.columns WHERE table_name='curator_runs'`. If `metadata` (jsonb) exists, write `{draft_model, review_model}` there. If it doesn't, append the same info to `notes`. **Do not run a migration to add the column** — that's out of scope.

### 2e. Dry-run semantics (explicit)
- `dry_run: true` STILL calls both LLMs (we measure cost + behavior).
- `dry_run: true` does NOT insert into `skill_versions`.
- `curator_runs` row is still written and updated normally with `notes` showing what *would* have been inserted.

### 2f. Fallback handling
- `getRouterKey()` helper kept as-is. If only `OPENAI_API_KEY` is available, both passes use `pickFallback()` (= `gpt-4o-mini`). The two-stage architecture still applies but both passes use the same cheap fallback model. Acceptable degradation.

---

## Step 3 — Edit `supabase/functions/mixture/index.ts`

- Move model selection **inside the request handler** (not module-scope constants):
  ```ts
  // inside Deno.serve handler, before fanout:
  const defaultModels = [pickModel("vote"), pickModel("vote_mid"), pickModel("vote")];
  const synthModel = pickModel("synthesize");
  ```
  Use `vote_mid` (not `synthesize`) for the middle voter — semantically clearer; future edits to the synthesizer task won't accidentally change voter composition.
  Computing inside the handler ensures env-var changes take effect on next request, not next isolate restart.
- **Caller-supplied `body.models` MUST be validated against the allowlist.** For each entry, call `assertAllowed(id)`; on violation return 400 `{error: "model_id_disallowed", id}`. Same validation applies to `body.synth_model` if present. This closes the bypass where a caller could request DeepSeek via this endpoint.
- **Server-side log line per voter:** `console.log(JSON.stringify({mixture_voter: model, ...}))` before each call so we can verify in Supabase logs which models were used. Do NOT add new fields to the response payload — minimizes API surface change.

---

## Step 4 — Edit `supabase/functions/delegate/index.ts`

- Replace conditional Claude/`gpt-4o-mini` logic with `pickModel("summarize")` for the OpenRouter path; keep `pickFallback()` for the OpenAI path.
- Same server-side `console.log({delegate_model: ...})` for observability.

---

## Step 5 — Edit `dashboard/supabase/functions/_shared/llm.ts`

**Single change**: `TIER_MODELS.cheap` from `"openai/gpt-4o-mini"` → `"anthropic/claude-haiku-4-5"`.

No env-var overrides added in dashboard. No mirrored `models.ts`. Keeps blast radius minimal.

**Identify which dashboard Edge Functions import this file** (`grep -r '_shared/llm' dashboard/supabase/functions/`) and redeploy each one in Step 7. The current importers (per the audit) are the compression-engine functions: Processor, Contradiction, Researcher.

---

## Step 6 — Env vars

Add to factory `.env.example`:
```
# Cost routing — override per-tier OpenRouter model ids.
# Allowlist enforced: must start with anthropic/, openai/, or google/gemini-
# Leave UNSET to use defaults baked into supabase/functions/_shared/models.ts.
# MODEL_CHEAP=anthropic/claude-haiku-4-5
# MODEL_MID=anthropic/claude-sonnet-4-6
# MODEL_STRONG=anthropic/claude-opus-4-7
```

(Lines commented out — defaults live in code, not in env. Only uncomment when overriding.)

**Do NOT set these as Supabase Edge Function secrets.** Defaults in code are the source of truth. Setting secrets creates a foot-gun where a future code default change is invisible because stale secrets win.

No change to dashboard `.env.example`.

---

## Step 7 — Deploy & verify

1. **Type-check:** `deno check` on each edited Edge Function file in factory and dashboard.
2. **Preflight model-id check:** call OpenRouter `GET /api/v1/models` (free), confirm all three approved model ids are present and not deprecated. If any is missing, halt and report. (Avoids smoke-testing a renamed model.)
3. **Deploy** via Supabase MCP `deploy_edge_function` to project `obizmgugsqirmnjpirnh`:
   - factory: `curator_pass`, `delegate`, `mixture`
   - dashboard: every function importing `_shared/llm.ts` (per Step 5 grep)
4. **Smoke tests** (curl with `x-capture-secret`):
   - `curator_pass` `{"hours": 24, "dry_run": true}` → expect 200, `proposals` array, `curator_runs` row with `status=ok` and `notes` showing `"draft: N → reviewed: M → inserted: 0"` (dry-run inserts zero). Open Supabase function logs and confirm two LLM calls and the model ids logged.
   - `delegate` with a small payload → expect 200; logs show `delegate_model` line with Haiku id.
   - `mixture` `{"question": "ping"}` → expect 200, 3 voter responses + 1 synth in payload. Logs show 3 `mixture_voter` lines with `[Haiku, Sonnet, Haiku]`.
   - One dashboard function that imports `_shared/llm.ts` (pick Processor) → smoke a small input, confirm 200.
5. **DB check:** query `curator_runs` and `ingest_runs` for any error rows in the smoke window.

**Rollback paths (per repo):**
- factory functions: prior version at `git show HEAD~1:supabase/functions/<name>/index.ts`
- dashboard functions: prior version at `cd dashboard && git show HEAD~1:supabase/functions/<name>/index.ts` (note: dashboard is a separate git repo cloned into `./dashboard/` per `.gitignore`)

Redeploy via Supabase MCP `deploy_edge_function`. Rollback is per-function, not all-or-nothing.

---

## Step 8 — Document

- Append a row to `ops/changelog.md` with date, decision summary, model list, savings estimate.
- One paragraph in `archive/architecture-rebuild-2026-04-17/03-decisions/decisions-log.md`: decision, rationale (cost), what's NOT routed and why, allowlist guard.

---

## Verification before claiming done

Run all of these and paste output to Edmund:
- [ ] `deno check` clean on all edited files
- [ ] OpenRouter `/models` preflight confirms all 3 approved ids exist
- [ ] All Edge Functions deployed (Supabase MCP returns success for each)
- [ ] All 4 smoke tests pass with status 200
- [ ] Supabase function logs show the EXPECTED model ids for each call (Haiku where cheap, Sonnet where mid)
- [ ] `curator_runs` last row shows two-stage `notes` and `dry_run: true` did not insert into `skill_versions` (verify with `SELECT count(*) FROM skill_versions WHERE created_by = 'curator_pass/run:<run_id>'` → 0)
- [ ] No error rows in `curator_runs` or `ingest_runs` from the smoke window
- [ ] `git diff --stat` and `git log --oneline -5` shown
- [ ] All Codex review findings either addressed or explicitly noted as accepted risk

Only then claim complete.

---

## Files touched (final)

- `supabase/functions/_shared/models.ts` (NEW — picker, allowlist guard, fallback helper)
- `supabase/functions/curator_pass/index.ts` (refactor to two-stage with ID allow-list + retry + schema validation)
- `supabase/functions/mixture/index.ts` (request-time model selection + voter logs)
- `supabase/functions/delegate/index.ts` (route through `pickModel` + log)
- `dashboard/supabase/functions/_shared/llm.ts` (one-line cheap tier change)
- `.env.example` (factory only — commented-out optional overrides)
- `ops/changelog.md` (append)
- `archive/architecture-rebuild-2026-04-17/03-decisions/decisions-log.md` (append)

---

## Ready-to-paste prompt for the autonomous run

```
Execute the plan at ops/plans/2026-05-03-cost-routing.md exactly. Do not skip steps. Do not extend scope.

Branch policy:
- factory repo: work on current branch `main`. Commit and push to `origin/main` after verification passes.
- dashboard repo (./dashboard/): work on current branch. Commit and push to its origin after verification passes.
- Do NOT open a PR in either repo.

After implementation, run the verification checklist at the bottom of the plan and paste each result inline. Print a final `git diff --stat` and `git log --oneline -5` for BOTH repos.

If any verification step fails, stop, roll back the affected Edge Function only (using the per-repo rollback paths in Step 7), and report. Do NOT push, do NOT commit the failed change.

Do NOT recursively invoke `codex exec` from within this session — Edmund runs Codex review separately afterward.
```
