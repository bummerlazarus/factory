# Handoff — late evening 2026-04-17

Fresh-session handoff from a ~4h autonomous run. Context window is long in the
prior session; this doc captures state so the next session can pick up cleanly.

## Ready-to-paste prompt for the next session

```
I'm continuing an autonomous factory rebuild run. Read these in order:

1. /Users/edmundmitchell/factory/CLAUDE.md
2. /Users/edmundmitchell/factory/architecture-rebuild-2026-04-17/06-handoffs/2026-04-17-late-evening-handoff.md
3. /Users/edmundmitchell/factory/architecture-rebuild-2026-04-17/06-handoffs/autonomy-charter.md
4. /Users/edmundmitchell/factory/architecture-rebuild-2026-04-17/06-handoffs/backlog.md
5. /Users/edmundmitchell/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork/Agent Personalities/README.md (MASTER agent roster — ALWAYS consult before touching agent folders)

Also load memory: /Users/edmundmitchell/.claude/projects/-Users-edmundmitchell-factory/memory/MEMORY.md — note the feedback entries on (a) standalone copy-paste shell commands, (b) consolidated action items at the END of every response with clickable markdown links.

## State summary (prior session)
- 20 commits shipped on `feat/department-workspace-overhaul` in dashboard repo
- 10 Edge Functions live (capture v19, capture-mcp, youtube-ingest, youtube-metrics, signals-ingest, beehiiv-metrics, + 2 tombstoned)
- 6 pg_cron jobs scheduled (librarian-daily, research-director-weekly, double-down-nightly, educated-bets-weekly, audience-painpoints-weekly, + older)
- Waves 1/2/3/4/5/6 substantially closed; Waves 7/8 partially
- `reference_docs.kind` migrated from CHECK → FK table (W9.1c) — future Skills just INSERT into `reference_docs_kinds`, no more constraint-rewrite drift
- Live dashboard pages: Home, Agents, Chat, Files, Workspace, Agent Tasks, Inbox, Promotions, Metrics, Research, Changelog

## Edmund's approvals carried forward (execute in the new session)
1. **Add Research to sidebar.** `components/layout/sidebar.tsx` has Edmund's uncommitted edits — he'll bundle, but the one-line entry is ready: `{ href: "/research", label: "Research", icon: Search }` (Search icon already imported). Go ahead and edit it; commit alongside whatever else is in that sidebar diff, OR just add the one line and leave the rest of Edmund's edits untouched.
2. **W9.1b destructive cleanup — APPROVED.** Drop orphaned tables `public.scheduled_tasks` (7 rows, 0 FKs, superseded by `agent_scheduled_tasks`) and `public.agent_habits` (0 rows, never populated). Also drop the `uuid-ossp` extension (W9.1a already migrated every default to `gen_random_uuid()`). One destructive migration, additive-and-preservation-free. Verify via `pg_depend` before dropping `uuid-ossp` — if anything non-public depends on it, stop.
3. **Continuous autonomous mode + subagent delegation.** Keep dispatching 3-5 subagents in parallel for independent work. Review + commit returns on main thread. Don't ask Edmund for routine decisions — just pick, document, and move. Only stop at the charter's hard-stop list or ambiguous scope decisions.
4. **Factory daily recap bug** — the scheduled task that runs the daily recap got stopped because it prompted for Notion permission approval. Investigate + fix so it runs unattended. Likely fix: pre-approve Notion writes in the scheduled task's hooks OR migrate the recap job to emit observations/reference_docs instead of Notion writes.

## Operating mode
- Charter at `06-handoffs/autonomy-charter.md` governs scope. Additive Supabase migrations pre-approved, destructive requires explicit Edmund approval (W9.1b is explicitly approved above).
- Dispatch subagents for all non-trivial work. Main thread is for: planning, reviewing returns, committing, coordinating between agents, one-off fixes.
- When dispatching: each subagent gets self-contained brief with acceptance criteria + constraints + return format.
- Commit granularly per epic (one commit per closed epic).
- Write run logs to `06-handoffs/autonomous-runs/YYYY-MM-DD-<slug>.md`.

## Immediate work queue (dispatch in this order)
1. **Sidebar edit** — 1-line add (~5 min main-thread).
2. **W9.1b destructive cleanup** — 1 subagent, ~20 min.
3. **Factory daily recap Notion fix** — 1 recon subagent first (figure out WHERE this job lives and WHY it stopped); may need a follow-on fix.
4. **W6.2c** — OpenAI synthesis Edge Function for research-director (rewrites theme/connection titles/bodies into readable proposals). Unblocks /research quality.
5. **W6.3** — IP map doc generator (Skill). Depends on W6.2a themes now done.
6. **W7.2** — Client project scaffolding. Kardia's client ops need per-project workspace shape.
7. **W8.2** — First specialist evaluated (depends on ≥2 months usage data — defer).
8. **Observation producer README update** — deferred from 54d827c.

## Known follow-ups / pending Edmund decisions (not blocking next session)
- **Cordis routing behavior** — Edmund to smoke-test live ("ingest this youtube", "CFCS status", "draft newsletter") and confirm Feynman/Corva/Kardia handoffs land correctly
- **Supabase PAT now live in `dashboard/.env.local`** — `supabase-cli` deploys work. You can `cd dashboard && set -a && . ./.env.local && set +a && npx supabase functions deploy <name> --project-ref obizmgugsqirmnjpirnh --no-verify-jwt` when MCP-deploy is inconvenient. Don't forget `--no-verify-jwt` (default is true, breaks x-capture-secret auth)
- **2 tombstoned functions** (`secret-probe`, `instagram-metrics`) — true-delete when convenient: `npx supabase functions delete <name> --project-ref obizmgugsqirmnjpirnh`
- **Similarity thresholds for themes/connections** are untuned (0.78 / 0.80) — revisit when Monday's cron has produced real data over 2+ weeks

## Key IDs and URLs
- **Supabase project:** `obizmgugsqirmnjpirnh`
- **Dashboard local:** http://localhost:3000 (dev server is running; managed via preview_* tools)
- **Capture endpoint:** https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture
- **Capture-MCP endpoint:** https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture-mcp (added to Edmund's Claude Code via `claude mcp add`)
- **CAPTURE_SECRET:** `<CAPTURE_SECRET — see ops/.env (gitignored)>` (reused across all Edge Function auth + MCP bearer)
- **Auth charter token approvals still active** — $10/run LLM cap, additive migrations pre-approved, Cordis-merge + kind-refactor path complete

## Hard stops (don't do without Edmund approval)
- Destructive SQL beyond the W9.1b approval above
- Prod deploy to any `edmund.dev`-class domain
- Adding new paid SaaS / billing changes / new MCP servers
- Touching gravityclaw/, production/, or other agent folders beyond COWORK_PATH canonical set

---

## What this session accomplished

### Commits this session (20)

- `3426ce6` W3.7 file-browser prod guard
- `10a60cd` W4.4 youtube-ingest
- `abaf46f` W4.5 signals-ingest (fixed missing-namespace bug)
- `0c65ee7` W2.4 capture-mcp
- `e14b882` W2.1+W4.2 capture() with voice memo
- `e7cbffa` W2.5 file upload (PDF/image/markdown)
- `54d827c` observation producer (W6.1 upstream gap)
- `9e76f9f` W5.5 beehiiv-metrics
- `4bbbd84` W5.3 youtube-metrics
- `91bc16c` W5.4 instagram-metrics (later abandoned)
- `9550fd0` rm instagram-metrics files (no token)
- `5728271` W5.7 /metrics page + unified view
- `775c17b` W6.1 Librarian pg_cron
- `7603c97` W5.8 Double-down Skill
- `60f36e7` W9.1a additive schema cleanup
- `6b71058` W5.9 Educated-bets Skill
- `2057fa4` W6.4 audience pain-points Skill
- `2b80e76` W6.2a emergent-theme SQL scan
- `919e2c8` W6.2b cross-silo connections
- `6f5c106` W9.1c kind-vocab FK refactor
- `6725893` W6.2d /research UI

### Decisions logged
- W1.3 = leave (stale commit stays local, defer to W9.4)
- W3.7 = option (b) — prod-disable with COWORK_PATH guard
- W4.4 = option A (two-phase, caller provides transcript)
- W2.4 = path α (mcp-lite Edge Function, co-located)
- W4.1/W5.1/W7.1 = ABANDONED wrong-scope scaffolds; functional needs routed to Feynman (ingest), Corva (drafting), Kardia (client ops) via additive CLAUDE.md extensions. Quarantine at `04-audit/2026-04-17-agent-misalignment-quarantine/`
- Cordis: single canonical at COWORK_PATH (factory copy deleted, content merged, routing table updated)
- W6.2 split into W6.2a/b/c/d sub-epics (per plan doc)

### Caught + fixed bugs
- W6.4 silently dropped `'educated-bet'` from kind CHECK (regressed Educated-bets cron briefly; restored by W6.2a)
- Stale GravityClaw Stop hook in `~/.claude/settings.json` (removed)
- `capture` function deployed via CLI without `--no-verify-jwt` (caught + re-deployed)

## Run logs written today (all in 06-handoffs/autonomous-runs/)
See that directory — 20+ run logs from this session, one per epic.

## Active cron jobs (verify post-handoff)
```sql
SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
```
Expected: `librarian-daily`, `research-director-weekly`, `double-down-nightly`, `educated-bets-weekly`, `audience-painpoints-weekly`, + Wave 0 crons if any.
