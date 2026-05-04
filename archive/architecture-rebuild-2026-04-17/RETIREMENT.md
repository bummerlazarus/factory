# Architecture Rebuild — Retired 2026-05-02

**Status:** ARCHIVED. Do not read this folder for current state. Read `CLAUDE.md` and the live code/Supabase instead.

The rebuild ran 2026-04-17 → 2026-04-26 (~10 days). Effectively all planned work shipped. This folder is preserved for history only.

## What shipped

- **Foundation (W0–W1):** Phase 0.5 security fixes, sessions/work_log/observations/skill_versions/reference_docs schema, pgvector + `memory` table + `match_memory()`, Pinecone → pgvector data migration (13,192 rows), MVP agents (Cordis + Corva).
- **Capture pipeline (W2):** `capture()` Edge Function with text/URL/voice/file paths, embeddings, Firecrawl enrichment, MCP tool, dashboard `/inbox` page with Realtime, `capture-api.md` webhook contract.
- **Dashboard Track A (W3):** Sessions/changelog/tasks/workspace/agents/messaging all migrated from filesystem to Supabase. `/files` gated. ~~Vercel deploy live at `dashboard-nine-delta-26.vercel.app`.~~ **Correction (2026-05-04):** the agent dashboard was never actually deployed to Vercel. `dashboard-nine-delta-26.vercel.app` belongs to a different app (DC podcast web) that happens to share the Vercel project name `dashboard`. The agent dashboard is local-only.
- **Ingest (W4):** Voice memos (Whisper), YouTube ingest, signals ingest, iPhone Shortcuts guide.
- **Content engine (W5):** Corva ideation/drafting/repurposing, IOC system imported, YouTube + Beehiiv metrics, `/metrics` panel, Double-Down + Educated-Bets cron skills. Instagram abandoned (no token); Circle deferred.
- **Research-director layer (W6):** Librarian daily clustering, themes scan, cross-silo connections scan, synthesis Edge Function, `/research` dashboard, IP-map regenerator, audience pain-points (YouTube comments).
- **Client ops (W7):** Kardia client-ops scope, `workstreams` table + FK refactor, `/clients` dashboard.
- **Specialist-spawn pattern (W8.1):** Workflow doc shipped (now at `ops/docs/specialist-spawn.md`).
- **Cutover & cleanup (W9):** Schema cleanup (additive + destructive), kind-vocabulary table + FK refactor, Q10 security hardening (RLS on 11 tables, search_path pinned, public bucket policy dropped).
- **Compression engine (W10):** Shared LLM helper with OpenRouter + N=3 stochastic consensus, typed-link vocabulary, four new agents (Axum/Sophia/Kontra/Kairos/Augustin), `/compression` route, full UI wiring.
- **Wave OA polish:** Tool-tag filtering, doc-sync admin endpoint, persistent wake queue, tsconfig cleanup.

## What did NOT ship and where it lives now

| Item | Status | Where |
|---|---|---|
| Pinecone index deletion | Console action — pending Edmund | Edmund's hands |
| GravityClaw / Railway formal cancellation | Repo gutted to `~/gravityclaw/web/` shell; Vercel project has no prod URL; Railway billing TBD | Edmund's hands |
| Custom domain on dashboard | Optional | Edmund's hands |
| First specialist agent | Genuinely future — needs volume + taste | `ops/docs/specialist-spawn.md` |
| Atomic-draft progressive rewrite cron (W10.8) | Held — rule-of-three not yet justified | Future |
| Circle metrics ingest (W5.6) | Deferred — Q12 leaning CLI-only; revisit on ZPM relaunch | Future |
| W5.3b YouTube Analytics OAuth (watch time / retention) | Planned, awaiting Edmund OAuth consent step | `archive/architecture-rebuild-2026-04-17/05-design/plans/2026-04-24-w5-3b-youtube-analytics-oauth.md` |
| Table-registry + intent-router proposal | Promoted to live proposal | `supabase/proposals/table-registry.md` (migration `020_table_registry.sql` applied 2026-05-02) |

## Where the still-living artifacts went

| Was | Now |
|---|---|
| `06-handoffs/autonomy-charter.md` | `ops/autonomy-charter.md` |
| `05-design/finished-state.md` | `ops/north-star.md` |
| `05-design/capture-api.md` | `ops/docs/capture-api.md` |
| `05-design/iphone-shortcuts-guide.md` | `ops/docs/iphone-shortcuts-guide.md` |
| `05-design/specialist-spawn.md` | `ops/docs/specialist-spawn.md` |
| `05-design/2026-04-26-table-registry-and-intent-router.md` | `supabase/proposals/table-registry.md` |

## Source of truth going forward

- **Current state of the system:** `CLAUDE.md` + `dashboard/`, `supabase/migrations/`, `ops/bin/`.
- **Operating principles + rules of engagement:** `ops/autonomy-charter.md`, `ops/north-star.md`.
- **Skills registry:** `~/.claude/skills/`, Supabase `public.skill_versions`, Notion "Systems, SOPs & Skills Index" (all three).
- **Decisions history:** Git log + this archive.

## Why this was retired

The folder accumulated stale phase-migration SQL (duplicated under `supabase/migrations/`), Q-numbering collisions in `open-questions.md`, and content from work that had already moved on (EM Research Lab, YouTube-scribe ingest). Agents were reading 200-line decisions logs as if they were current state. The fix was retirement, not maintenance.
