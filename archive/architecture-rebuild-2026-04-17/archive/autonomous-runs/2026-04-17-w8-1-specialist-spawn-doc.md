# W8.1 — Specialist-spawn workflow doc

## Epic

**ID:** W8.1
**Title:** Specialist-spawn workflow doc
**Backlog row:** Wave 8 — Expanding-team pattern
**Link:** [`backlog.md`](../backlog.md) → W8.1

## Plan

No separate plan file — the deliverable IS the doc. Task spec inlined in the run prompt (Autonomous — doc only, no code).

## Status

**🟢 DONE**

## Files touched

- **Created:** `architecture-rebuild-2026-04-17/05-design/specialist-spawn.md` (329 lines)
- **Created:** `architecture-rebuild-2026-04-17/06-handoffs/autonomous-runs/2026-04-17-w8-1-specialist-spawn-doc.md` (this file)
- **Edited:** `architecture-rebuild-2026-04-17/06-handoffs/backlog.md` (flipped W8.1 status ⚪ → 🟢)

## Supabase migrations applied

None — pure documentation run.

## Subagents dispatched

None — single-session autonomous doc run.

## Verification output

- `wc -l specialist-spawn.md` → **329 lines**, within the 250–500 target.
- All 10 required sections present (Purpose / Decision criteria / Proposal row shape / Approval flow / Scaffolding runbook / Tool allowlist pattern / Memory namespace / Retire path / First-candidate hint / Open questions), plus header + change-log.
- Cross-references resolved against the live tree:
  - `COWORK_PATH/Agent Personalities/README.md` — roster table confirmed
  - `content/CLAUDE.md` — `## Rebuild 2026-04-17 extensions` section shape used as the extension precedent
  - `03-decisions/2026-04-17-agent-scope-reassignment.md` — cited as the extension-vs-new-agent guardrail
  - `/inbox/promotions` — confirmed in `dashboard/app/inbox/promotions` as the approval-UI precedent for the proposed `/inbox/specialists`
- Style matches `05-design/capture-api.md` + `dashboard-architecture.md` (header block with status + related docs; tabular fields; skeleton templates where useful; explicit "not doing" call-outs).

## Decisions made

Logged in the doc itself rather than `03-decisions/decisions-log.md` — these are workflow-doc defaults, not firm architectural decisions. Captured here for traceability:

1. **Proposal row shape = `reference_docs` with `kind='specialist-proposal'`.** No new table. Proposal volume is expected to be 0–2 per quarter; a dedicated table is over-engineering. Revisit if volume grows.
2. **Approval flow = Option A (`/inbox/specialists`) as target, Option B (notebook-review) as the bridge.** Doc explicitly recommends deferring the UI build until there's a second real proposal in the queue.
3. **Tool allowlist inheritance = inherit parent + narrow by default.** Specialists start with the parent agent's allowlist and remove. Expansion requires justification in the proposal.
4. **Memory namespace convention = `<slug>-memory`** — matches existing roster.
5. **Retirement threshold (provisional) = <4 sessions over 8 weeks** — flagged as Q-D for Edmund to revisit after real data.
6. **Retirement preserves the folder** (`agents/_retired/<slug>/`) and the memory namespace (read-only). No destructive action.
7. **Announcement-to-Cordis uses `capture()` with `source='mcp'`** landing in `knowledge` namespace so subsequent `match_memory()` queries surface the new specialist.

## Follow-ups flagged

Open questions left for Edmund (per the doc's §10):

- **Q-A** — Confirm where Cordis's routing table actually lives before first scaffolding run.
- **Q-B** — Policy on proposed emoji/color (Claude-picks-then-Edmund-edits vs. palette doc vs. pre-picked list).
- **Q-C** — Priority of `/inbox/specialists` UI — recommend deferring until there's a second proposal queued.
- **Q-D** — Retirement threshold (`<4 sessions / 8 weeks`) is a guess; revisit after the first specialist has ≥8 weeks of data.
- **Q-E** — Verify `match_memory()` cross-namespace default before the first specialist ships.
- **Q-F** — Do handoff-trigger keywords **move** from parent to spin-off or stay/duplicate? Doc recommends **move** + parent-narrowed; needs Edmund's call.

## Cost

Negligible — pure doc run, no embedding / LLM calls beyond reading-existing-files.

## What's next

Per `backlog.md`, Wave 8's remaining item is **W8.2 — First specialist evaluated**, blocked (⛔) on "≥2 months of usage data." Not actionable today.

Next actionable Wave 9 items are blocked on decisions. Next likely unblocked backlog item: **W1.4 — Dual-read parity report** (requires 7 days of dual-read log accumulation; check whether 7 days have elapsed since W1.2 landing).
