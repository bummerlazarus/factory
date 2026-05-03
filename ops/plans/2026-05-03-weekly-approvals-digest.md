# Weekly approvals digest + one-click revoke — plan (rev 1)

**Date:** 2026-05-03
**Author:** Claude (with Edmund)
**Status:** proposed
**Repo:** dashboard
**Why:** time-delayed second-line defense. If Edmund approves a bad skill in the moment (despite the promotion-evidence modal), the digest catches it within a week and a single click reverts the row to `status='proposed'` so it stops influencing agent behavior. Bounded compounding damage.

## Goal

Surface every `skill_versions` row that flipped to `status='approved'` in the last 7 days as a scannable list, each with its cited evidence and a one-click Revoke button.

## Out of scope

- Email digest / push notifications. Dashboard tile only — Edmund opens the dashboard daily anyway.
- "Established vs. tentative" tagging on skills. Separate concern.
- Audit by another agent. Separate concern.

## Approach

### 1. New page: `/inbox/recent-approvals`

(Or a new section on the existing promotions page — leaning new page so promotions stays focused on pending.)

Lists `skill_versions` where `status='approved'` AND `created_at > now() - interval '7 days'`, ordered by `created_at DESC`.

Each row shows:
- `skill_name` v`version`
- `changelog` (rationale)
- The same Evidence section as the promotion-evidence modal (cited rows with content) — reuses that component
- "Revoke" button

### 2. Revoke endpoint

`POST /api/skills/revoke` with body `{ id: string }`.
- Verifies the row is `status='approved'`
- Flips `status='proposed'`
- Appends to changelog: `"\n\n— revoked by Edmund on YYYY-MM-DD"` (so the audit trail survives)
- Returns 200; UI re-fetches

Single-click; no confirm modal here. Revoke is the safer direction; the original promotion already had the deliberate gate.

### 3. Home tile

Small tile on dashboard home: "Approved this week (N)" linking to `/inbox/recent-approvals`. If `N > 0` the tile is visible; if 0, hidden. Keeps the surface clean on weeks where there's nothing to review.

### 4. Empty state

If zero approvals in the last 7 days: page shows a small "Nothing to review" empty state. Don't push noise.

## Files touched

- `app/inbox/recent-approvals/page.tsx` (new)
- `app/api/skills/revoke/route.ts` (new)
- Reuse the Evidence section component from the promotion-evidence-modal plan
- One small home-tile component update to include the count

## Schema check

- `skill_versions.status` already exists with `proposed/approved/...` values. No migration.
- `skill_versions.changelog` is text. Appending the revoke note is a `set: { changelog: prev + '...' }` from the route. Read-modify-write with no concurrency concern (single writer = Edmund).

## Acceptance criteria

- [ ] `/inbox/recent-approvals` exists and lists last-7-day `approved` rows newest-first
- [ ] Each row shows Evidence section (cited rows with content, MISSING badge if id not found)
- [ ] Revoke button flips row to `status='proposed'` and appends a dated note to `changelog`
- [ ] Home tile shows count and links to the page when count > 0; hidden when 0
- [ ] After revoke, the row appears at `/inbox/promotions` again (because it's back to `proposed`)
- [ ] Smoke: manually approve a test row, verify it appears in the digest, click revoke, verify it returns to promotions

## Estimated effort

~1 hour (the Evidence component is shared with the promotion-evidence-modal plan, so most of the work is the new page + the revoke route).

## Rollback

Revert the commits + drop the route. The `revoked-on-` text stays in `changelog` rows that were revoked during the experiment — harmless audit residue.

## Open question

Does Edmund want a 14-day window instead of 7? Plan says 7 because that bounds compounding to one week's worth of agent runs. Easy to change.
