# Promotion-time evidence modal — plan (rev 1)

**Date:** 2026-05-03
**Author:** Claude (with Edmund)
**Status:** proposed
**Repo:** dashboard
**Why:** second-line defense against curator_pass's fake-reference bypass. The deterministic + LLM gates can be fooled. The human gate (Edmund at `/inbox/promotions`) is the real safety net — but only if Edmund actually reads the evidence before clicking Approve. This plan makes that the path of least resistance.

## Goal

When Edmund clicks Approve on a pending `skill_versions` row at `/inbox/promotions`, the dashboard renders the actual cited evidence rows inline (work_log summary, ingest_run title, session title) so a mismatch is visible at a glance. Reject path stays one-click; Approve path requires a deliberate "I read the evidence" confirm.

## Out of scope

- Changing curator_pass behavior. This is a UX layer over what curator already produces.
- Auto-revoke / scheduled audit. That's the separate weekly-digest plan.
- Mobile / touch UX. Desk surface only for now.

## Approach

### 1. Promotion card expansion

`/inbox/promotions` already lists pending `skill_versions` rows. Each row has `metadata.source_refs` (an array of `{kind, id, note}`). Today the card likely shows `skill_name`, `version`, `changelog` (rationale), and an Approve / Reject button.

Add an **Evidence** section to each card:
- For every entry in `metadata.source_refs`, render one row:
  - `kind` badge (`work_log` | `ingest_run` | `session`)
  - The `note` field from the source_ref
  - Below: the actual content of that referenced row, truncated to 240 chars + "Open" link to the full row.
- Content lookup: a single Supabase query per render that batches all cited ids by table. Three small selects:
  - `work_log` where id IN (…) → `summary, kind, project, created_at`
  - `ingest_runs` where id IN (…) → `source_title, source_type, status, started_at`
  - `agent_conversations` where session_id IN (…) → `title, persona_id, updated_at`
- If a cited id has no matching row (shouldn't happen post-Stage-C-trim, but defensive): show a red "MISSING — id not found in <table>" badge. This itself is a smell worth surfacing.

### 2. Approve flow

Today: click Approve → row flips to `status='approved'`.

After this change:
- First click: opens a small modal showing the proposal body + rendered evidence one more time, with two buttons: "Confirm approve" and "Cancel".
- Second click in the modal: actual mutation.
- Adds ~2 seconds of friction; impossible to approve on autopilot without seeing the evidence.

Reject button stays one-click (fast-rejecting noise should stay easy).

### 3. Optional: an "I checked the evidence" toggle

Skip for v1. The modal itself is the friction.

## Files touched

- `app/inbox/promotions/page.tsx` (or its card component) — add Evidence section, add modal
- A small server-side helper (probably already exists) that batches the three selects given a set of source_refs
- Component tests: at minimum, render-with-mock-data test for the Evidence section

## Acceptance criteria

- [ ] Each pending `skill_versions` row at `/inbox/promotions` shows its cited evidence rows inline with title + 240-char preview + "Open" link
- [ ] Approve opens a confirm modal that re-shows the body + evidence; second click commits
- [ ] Cited id with no matching row shows a red MISSING badge
- [ ] Reject stays one-click
- [ ] No noticeable page-load slowdown (one batch select per source_kind, not per ref)
- [ ] Manual smoke: run curator_pass dry_run with current data, manually create a `proposed` row from the result, open `/inbox/promotions`, verify evidence renders correctly

## Estimated effort

~1.5 hours (one component refactor + a modal + the batched select).

## Rollback

Revert the page commit. No DB / schema changes; fully reversible.
