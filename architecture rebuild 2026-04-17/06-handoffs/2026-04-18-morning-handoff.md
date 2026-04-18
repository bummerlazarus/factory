# Handoff — 2026-04-18 morning

Continuation run from the late-evening handoff. Short session, all six queue items closed.

## What shipped this run

| Item | Status | Notes |
|---|---|---|
| Sidebar `/research` nav link | 🟢 committed `8f0d19f` | Clean one-line add; Edmund's Inbox/Promotions/Metrics edits left uncommitted in working copy as they were. |
| W9.1b destructive cleanup | 🟢 | `DROP TABLE scheduled_tasks, agent_habits` + `DROP EXTENSION "uuid-ossp"` applied as migration `schema_cleanup_destructive_2026_04_17`. Pre-drop pg_depend check clean. Run log + backlog updated. |
| Daily-recap Notion bug | 🟢 | Root cause: MCP UUID mismatch in `~/.claude/settings.json` (old `mcp__claude_ai_Notion__*` pre-approved, active server is `mcp__c539fb18-*`). Fix applied additively — 7 new entries added, old entries left in place. Recon doc at `04-audit/2026-04-17-daily-recap-notion-bug-recon.md`. Verification needs tonight's 21:00 CT firing. |
| W6.2c synthesis Edge Function | 🟢 committed `655755f` | `research-director-synthesis` deployed; uses gpt-4o-mini; idempotent on `metadata.synthesis_version`; chained onto `research-director-weekly` cron at Mon 07:05 UTC. ~$0.0002 OpenAI spend for full end-to-end verification. |
| W6.3 IP map generator | 🟢 committed `655755f` | Three migrations applied (kind + function + cron). `ip-map-weekly` cron at Mon 08:00 UTC. First run rendered correctly with 1 authored framework (IOC) + zero in other sections. |
| W7.2 plan | 🟡 BLOCKED on 3 Edmund Qs | Split into W7.2a/b/c/d. Plan at `05-design/plans/2026-04-17-w7-2-client-scaffolding.md`. See below for questions. |

## Commits this run (on `feat/department-workspace-overhaul`)

- `8f0d19f` feat(sidebar): surface /research in nav (W6.2d follow-up)
- `655755f` feat: research-director synthesis Edge Function + IP map generator (W6.2c + W6.3)

## Edmund — three decisions needed to unblock W7.2a

1. **Is Lisa in scope as a 4th DC client?** No contact / cadence / deliverables on file. If yes, you owe a one-paragraph scope doc. If no, tighten `artifacts.client` enum to 3 (`cfcs` / `liv-harrison` / `culture-project`).
2. **`em-brand` vs `cordial-catholics` — merge or keep separate?** Recommendation: merge into `em-brand` with `artifacts.stream='cordial-catholics'`. Current Kardia extension enumerates both.
3. **IOC framework placement.** Its own project, part of `real-true`, or infrastructure (no project tag)? Recommendation: no project tag — keeps drift-noise down.

## Verify tonight

- 21:00 America/Chicago — scheduled `factory-daily-recap` task should complete unattended (Option A Notion fix). If it still prompts, escalate to Option B (migrate recap to Supabase `daily_recaps` table, ~30–45 min).
- Monday 07:00 UTC — `research-director-weekly` chained cron now runs themes scan → connections scan → synthesis Edge Function. First real-data synthesis output should land in `/research`.
- Monday 08:00 UTC — `ip-map-weekly` cron runs `ip_map_regenerate()`. Check `reference_docs WHERE slug='ip-map'` for the Monday-morning refresh.

## Next run's starting queue

Once Edmund resolves the three Qs above:

1. **W7.2a** — seed projects + scope docs (S).
2. **W7.2b** — projects table + FK refactor (S).
3. **W7.2c** — `/clients` dashboard surface (M).
4. **W7.2d** — Kardia CLAUDE.md canonical SQL (S).

Independent items available if W7.2 stays blocked:

- **W1.4** — dual-read parity report (needs 7+ days of dualread_log; check `memory_dualread_log` row count).
- **Optional /ip-map UI surface** — small server component rendering the single `slug='ip-map'` row via react-markdown. Could slot into `/research` or `/workspace`.
- **LLM polish on IP map** — Edge Function (preview→confirm) to rewrite sections in Edmund's voice.
- **Edit iterations on `/research`** — render `metadata.synthesis_json.action` as a CTA button.
- **Tombstoned function cleanup** — `npx supabase functions delete secret-probe --project-ref obizmgugsqirmnjpirnh` and same for `instagram-metrics`.

## Uncommitted state in `dashboard/` working copy (Edmund's, not mine)

- `CLAUDE.md`, `lib/icons.ts`, `components/layout/sidebar.tsx` modified
- `app/api/promotions/`, `app/inbox/`, `lib/supabase-browser.ts` untracked (W2.2/W2.2b/Promotions pages that Edmund has working locally but hasn't committed)
- `data/agent-runs/`, `public/carousel-example.html`, `supabase/.temp/` untracked — misc

I deliberately left all of this as-is. If Edmund wants any of it bundled into main, that's his call.

## Charter notes

- Touched `~/.claude/settings.json` (normally off-limits) under explicit queue authorization #3.
- All other work stayed inside the allowed perimeter (dashboard/, architecture rebuild/, Supabase additive-or-approved).
- $10/run cap: well under. W6.2c was the only OpenAI spend — pennies.
