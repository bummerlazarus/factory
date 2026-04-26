# Phase 3 MVP execution log — 2026-04-17

Run parallel to Phase 2. Scope: Cordis + Corva + dashboard `/inbox/promotions` + Daily Recap, per Q7 decision. Touch rules respected: no edits to `/ops/scripts/`, Supabase `memory` table / `vector` extension, decisions-log, `/05-design/phase-2-migrations/`.

## Deliverables shipped

### 1. Cordis agent (system prompt only)
- `/Users/edmundmitchell/factory/agents/cordis/identity.md`
- `/Users/edmundmitchell/factory/agents/cordis/CLAUDE.md`

Match dashboard's agent-row format (Name / Role / Emoji / Accent Color + domain). The existing `agents` table in Supabase already has a `cordis` row with a generic router prompt; this on-disk pair is the canonical source for the CEO-Desk-Cordis behavior and a future DB backfill. Explicit rules: inline observations at `confidence ≤ 0.6` only; never auto-promote; tag `work_log.project` with the closed set `factory / zpm / cordial-catholics / real-true / faith-ai / dc-clients / em-brand`; prefer `capture()` over raw SQL writes.

### 2. Corva session-retro Skill + seed voice-tone Skill
- `/Users/edmundmitchell/factory/skills/session-retro/SKILL.md` (Corva; 448-char description)
- `/Users/edmundmitchell/factory/skills/voice-tone/SKILL.md` (seed v1 Skill; 378-char description; "Under active curation" header note)
- `/Users/edmundmitchell/factory/skills/daily-recap/SKILL.md` (see #4)

All three have valid YAML frontmatter (`name:` + `description:`), descriptions ≤1024 chars, markdown body below the frontmatter. Anthropic SKILL.md format verbatim (per 2026-04-17 Skills decision).

### 3. Dashboard `/inbox/promotions`
- Migration: `/05-design/phase-3-migrations/014_skill_versions_add_status.sql` — applied to `obizmgugsqirmnjpirnh` as `phase_3_014_skill_versions_add_status`. Adds `status` (NOT NULL default `'approved'`, CHECK in `{proposed, approved, rejected, stale}`), `approved_at`, `approved_by`, `rejection_reason`. Backfills existing rows to `approved`. Partial index `idx_skill_versions_proposed_created_desc` on `(created_at DESC) WHERE status='proposed'`.
- Route (server component): `/Users/edmundmitchell/factory/dashboard/app/inbox/promotions/page.tsx`
- Client component (per-row actions + LCS line diff + editor): `/Users/edmundmitchell/factory/dashboard/app/inbox/promotions/promotion-card.tsx`
- API: `/Users/edmundmitchell/factory/dashboard/app/api/promotions/route.ts` — POST approve / reject (with optional `editedBody` / `editedChangelog`); writes `work_log` kind=`retro` entry on both paths.
- Sidebar: added "Promotions" nav item (Check icon) under the existing nav stack in `components/layout/sidebar.tsx`.
- Auth: follows the existing dashboard pattern — service_role via `lib/supabase.ts`. No separate auth layer invented.

### 4. Daily Recap scheduled Skill
- `/Users/edmundmitchell/factory/skills/daily-recap/SKILL.md` — describes the three queries, the 5-line template, Notion posting, `--dry-run` mode, and the MVP decision to skip `home_cards` (see deviations).
- Registered via `mcp__scheduled-tasks__create_scheduled_task` as `factory-daily-recap`, cron `0 21 * * *`, tz America/Chicago (local per the scheduled-tasks server). Visible via `list_scheduled_tasks`. Next run ~ 21:06 CT tonight (small jitter from scheduler).

## Verification run

- `/inbox/promotions` renders on a fresh dev server at http://localhost:3000/inbox/promotions. Curl returns 200 and the HTML contains the proposed row.
- Manual round-trip: inserted one proposed row (`id=e6699648-…`), POST `approve` → `{ok:true}`, row flipped to `status=approved`, `approved_at` set, `approved_by='edmund'`, and a `work_log` row `kind=retro` summary `"Approved skill update: voice-tone v2"` was created. Same tested with a reject row (`id=8c4e989c-…` rejected, `rejection_reason='Generic corporate-speak'`, matching work_log entry written).
- Empty state: after the approve+reject, the page returned "Nothing pending". Re-seeded one live proposal (`id=2c52e0f1-…`, `voice-tone` v4) so Edmund sees a row when he opens the dashboard.
- Daily Recap dry-run query produced: `factory: note, retro — 3 entries / (quiet) / (quiet) / Skills updated: voice-tone@v1, voice-tone@v2 / 1 promotion proposal(s) waiting. /inbox/promotions` — the expected 5-line shape.
- Migration 014 verified: `SELECT column_name FROM information_schema.columns WHERE table_name='skill_versions'` returns the four new columns. Check constraint present.
- SKILL.md frontmatter verified (name + description, all descriptions well under 1024 chars).

## Deviations from the Q7 brainstorm (with rationale)

1. **Daily Recap skips the dashboard home card.** Brainstorm §4.1 called for a home card; MVP dropped it because `home_cards` table doesn't exist and the sidebar will soon show a pending-count badge once Realtime wiring is in place (future phase). Rationale: don't outbuild Anthropic; Notion mirror is the mobile surface, `/inbox/promotions` is the system of record. SKILL.md documents the decision in the "Follow-ups" section.
2. **Sidebar link is `/inbox/promotions` directly.** There's no `/inbox` index yet (only `/tasks` exists in the Phase 2 dashboard); rather than scaffold an empty `/inbox` landing, the Promotions nav item goes to `/inbox/promotions` directly. Future sub-tabs (captures, proposals, low-conf observations) will sit next to it.
3. **Cordis system-prompt on disk, not in the `agents` table row.** The existing DB row for `cordis` has an older routing-style prompt; replacing it would conflict with the Phase 2 dashboard loader (`lib/agents.ts`). MVP keeps the on-disk identity+CLAUDE.md as the canonical Phase-3 Cordis behavior. A one-line backfill UPDATE into `agents.claude_md` + `agents.identity_md` is a follow-up when Phase 2 clears.
4. **Dashboard auth = service_role via `lib/supabase.ts`.** Matches the current dashboard; single-user context per Q11 decision. Not a deviation per se — flagging so it's explicit.

## Test proposal one-liner

Put one "proposed" row into the queue from any terminal with Supabase MCP access (or paste into the SQL editor):

```sql
INSERT INTO skill_versions (skill_name, version, body, changelog, created_by, status)
VALUES ('voice-tone', (SELECT COALESCE(max(version),0)+1 FROM skill_versions WHERE skill_name='voice-tone'), E'# Voice & Tone\n\n- new principle: ship the draft.\n', 'Test proposal for /inbox/promotions', 'agent:manual-test', 'proposed') RETURNING id;
```

It will appear on `/inbox/promotions` immediately on refresh.

## Open questions routed here (not blocking MVP)

- Notion "Daily Recaps" parent page ID — created lazily on first real run. If Edmund wants a specific page, edit `skills/daily-recap/SKILL.md` step 4 to hardcode the page ID.
- `home_cards` table shape — deferred until Realtime badge work lands.
- Cordis-DB-row backfill — deferred until Phase 2 dashboard Supabase migration completes.
- Stale auto-expiry — the `stale` status value is present in the CHECK constraint but no cron flips rows yet. Future cron: nightly `UPDATE skill_versions SET status='stale' WHERE status='proposed' AND created_at < now() - interval '14 days'`.

## Files touched

```
agents/cordis/identity.md                             (new)
agents/cordis/CLAUDE.md                               (new)
skills/session-retro/SKILL.md                         (new)
skills/voice-tone/SKILL.md                            (new)
skills/daily-recap/SKILL.md                           (new)
architecture-rebuild-2026-04-17/05-design/phase-3-migrations/014_skill_versions_add_status.sql  (new)
architecture-rebuild-2026-04-17/06-handoffs/2026-04-17-phase-3-execution-log.md                (this file)
dashboard/app/inbox/promotions/page.tsx               (new)
dashboard/app/inbox/promotions/promotion-card.tsx     (new)
dashboard/app/api/promotions/route.ts                 (new)
dashboard/components/layout/sidebar.tsx               (edit: add Promotions nav item + Check icon import)
```

Supabase:
- migration `phase_3_014_skill_versions_add_status` applied to project `obizmgugsqirmnjpirnh`.
- seed rows: `voice-tone` v1 (approved), v2 (approved via round-trip test), v3 (rejected), v4 (proposed — live for Edmund).
- work_log rows written for each approve/reject.

Scheduled tasks:
- `factory-daily-recap` created, `0 21 * * *` America/Chicago.

## Dev-server notes

The dashboard dev server at pid `69141` (running from an earlier Phase 2 session) did not pick up new `app/api/*` files via HMR on Next 16.2.3 + Turbopack — POSTs to newly-added route handlers returned 404 until the server was restarted. Killed and relaunched on port 3000 with `nohup npm run dev -- -p 3000`; API compiled and returned 200 immediately. Worth flagging for future Phase 2 / Phase 3 parallelism: **the Phase 2 session's dev server needs to be bounced after this phase's code lands**, or tell users to restart before clicking Approve/Reject in the UI.
