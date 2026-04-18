# Handoff — Rebuild State 2026-04-17

**Purpose:** Hand off the factory architecture rebuild to a fresh Claude Code session.

## TL;DR

Edmund is retiring GravityClaw (Railway-hosted custom MCP, 46 tools, crashy) and consolidating his personal AI stack onto **Supabase + native MCPs + Claude platform features**. The existing `/factory/dashboard/` app (Next.js, was `local agent dashboard/`) is being migrated from filesystem I/O to Supabase so it can become the production dashboard.

Guiding principle: **Edmund will not outbuild Anthropic.** Default priority = Claude native → native MCPs → Supabase Edge Functions → custom (last resort).

## The vision (5 pillars, priority order)

1. **Rich data capture first** — Supabase schema is too thin; need sessions / chat history / work logs / token usage ASAP
2. **One source of truth** — goals/values/KPIs/framework docs consolidate into Supabase; Notion surfaces them
3. **SOPs as Skills** — versioned Skills that improve over time as content is ingested
4. **Self-improving loops** — agents write observations; higher-level Skills promote patterns (approval-gated)
5. **Proactive surfacing** — visual progress on goals, daily "what you pushed forward" recap, last-touched-per-project

Full detail: `01-context/vision-and-priorities.md`.

## The three-system picture

- **Personal database** = Supabase (rows + blobs + maybe pgvector) + Pinecone (until Q2) + Notion (ops source-of-truth)
- **Multi-agent workflows** = Claude as runtime; `/factory/dashboard/` as coordination UI
- **One inbox** = single `capture()` Edge Function; three entry points (Claude chat, dashboard `/inbox`, webhook); Supabase Realtime bridges live

## What's been decided (locked)

See `03-decisions/decisions-log.md`. Key entries:
- Retire GravityClaw → Claude-native + native MCP
- Six-folder target repo: `/supabase /pinecone /skills /agents /dashboard /ops`
- Dashboard = existing `/factory/dashboard/` code, being migrated to Supabase (not a rebuild)
- Inbox = pipeline, not a place (one Edge Function, three entry points)
- Supabase Realtime = the bridge between Claude chat writes and live dashboard UI
- **Phase 0.5 security fixes: ✅ APPLIED** to live Supabase (4 migrations — scorecard_responses, vault_files, agent_conversations, agent_scratchpad)

## What's open (needs decisions)

See `03-decisions/open-questions.md`. Highlights:

- **Q2 — Vector strategy.** (a) migrate Pinecone to integrated index / (b) keep BYO Pinecone + SDK from Edge Functions / (c) consolidate to pgvector (OB-1 pattern) / (d) file-based. Still exploring. Doesn't block Phase 1.
- **Q7 — Multi-agent workflow shape.** Now partially informed by the workflows walkthrough + vision. Still needs brainstorm on which agents do what observations, what approval UI, which surfacing Skills first.
- **Q8 — Split Supabase into multiple projects?** Current project holds agent stack + CMS + ZPM app. Leaning "no, not until real customers."
- **Q10 — Broader security hardening.** 7 more tables have RLS off, 3 functions with mutable search_path, public `media` bucket listing. Do before going public.
- **Q11 — Hosting/privacy model.** Edmund previously built a Telegram capture app (Railway crashed, abandoned) and values locally-hosted. Options: (a) Vercel+auth, (b) Tailscale-only self-hosted, (c) skip dashboard v1, (d) hybrid. Decide before standing up production.

## What's been shipped (artifacts on disk)

### Audits (in `04-audit/`)
- `2026-04-17-gravityclaw-tool-map.md` — all 46 tools mapped (tables, APIs, destinations)
- `2026-04-17-flags-audit.md` — dead tools, duplicates, broken paths
- `2026-04-17-supabase-audit.md` — 46 tables, ~5,367 rows, 0 edge functions, security flags
- `2026-04-17-pinecone-audit.md` — 1 index, 14,491 vectors (3072-dim BYO), 8 namespaces
- `2026-04-17-notion-audit.md` — 11 active DBs, role clarification
- `2026-04-17-rls-current-state.md` — pre-Phase-0.5 RLS snapshot
- `2026-04-17-ob1-review.md` — OB-1 architectural patterns (pgvector pattern, extensions-as-modules, remote MCP)
- `2026-04-17-rewire-synthesis.md` — rewire plan synthesis across tool guides

### Phase 0.5 migrations (in `05-design/phase-0-5-migrations/`)
- `001_scorecard_responses_lock_update.sql` — applied ✅
- `002_vault_files_remove_anon_read.sql` — applied ✅
- `003_agent_conversations_enable_rls.sql` — applied ✅
- `004_agent_scratchpad_enable_rls.sql` — applied ✅

### Design (in `05-design/`)
- `target-architecture.md` — three-system picture, five-pillars→tech mapping, layers
- `migration-plan.md` — phased rewire (Phase 0.5 done; Phase 1 next)
- `dashboard-architecture.md` — Supabase migration + new capture pipeline, two tracks
- `data-model.md` — schema cleanup list, naming conventions, pgvector sketch if Q2 resolves that way

### Context (in `01-context/`)
- `profile.md` — who Edmund is, ventures, working style
- `stack.md` — current tech stack + preferences
- `principles.md` — "will not outbuild Anthropic" + rules
- `vision-and-priorities.md` — the five pillars
- `workflows-and-capture.md` — filled in from Edmund's 2026-04-17 walkthrough

### Decisions (in `03-decisions/`)
- `decisions-log.md` — ADR-style record
- `open-questions.md` — Q1–Q11

## Relevant external paths

- **Rebuild notebook:** `/Users/edmundmitchell/factory/architecture rebuild 2026-04-17/`
- **Production dashboard (being migrated):** `/Users/edmundmitchell/factory/dashboard/`
- **Dashboard Supabase migration plan:** `/dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md`
- **GravityClaw repo (to retire):** `/Users/edmundmitchell/gravityclaw/`
- **GravityClaw Railway URL** (do NOT decommission without approval): `gravityclaw-production-8d93.up.railway.app`
- **Supabase project ID:** `obizmgugsqirmnjpirnh`
- **Pinecone index:** `gravity-claw`
- **OB-1 reference:** `/Users/edmundmitchell/factory/research/reference-repos/OB1-main/`
- **Tool guides (20+ docs):** `/Users/edmundmitchell/factory/research/tool-guides/`

## Recommended next moves (pick one)

1. **Phase 1 — Delete dead GravityClaw tools.** 11 confirmed-dead tools (broken paths, missing files, no consumers). Low-risk cleanup. See `05-design/migration-plan.md` Phase 1. Zero Supabase changes.
2. **Phase 1.5 — Expand thin schemas.** Build the tables pillar 1 asks for: `sessions`, `work_log`, `observations`, `skill_versions`, `reference_docs`, plus `session_id` on `agent_messages`. See `01-context/workflows-and-capture.md` → "Thin-schema gaps."
3. **Track B step 1 — `capture()` Edge Function MVP.** Text + URL happy path. Unblocks the inbox pipeline for all three entry points. See `05-design/dashboard-architecture.md` Track B.
4. **Resolve Q2 (vector strategy).** Picking a/b/c/d unblocks the semantic-search rewire. OB-1 review favors (c) consolidate to pgvector; rewire synthesis leans (b) keep BYO Pinecone.
5. **Resolve Q11 (hosting/privacy).** Affects whether the dashboard deploys to Vercel, runs on Tailscale self-hosted, etc.
6. **Brainstorm Q7 (multi-agent workflows).** Now has shape; needs concrete answers.

Edmund's working style: markdown-first, conversation-driven, hybrid (review files in sidebar while chatting). Decisions get logged to `decisions-log.md` when firm; explorations stay in `open-questions.md`.

## User values & constraints (don't forget)

- **Speed over money** — optimize for velocity, not cost
- **Reliability over cleverness** — don't add complexity for complexity's sake
- **Will not outbuild Anthropic** — the rebuild's organizing principle
- **Markdown + sidebar + chat** — how Edmund works
- **ADHD → needs structure** — named folders, clear entry points, numbered phases
- **Don't overexplain** — he reads the diff; trailing summaries unnecessary
- **Never use `browser_subagent`** — crashes the system
- **Firecrawl is primary web tool** — browser control last resort
- **If MCP tools fail twice, stop and ask**
- **Read files before modifying** — never guess at business logic

---

## Ready-to-paste prompt for the new session

```
I'm continuing the factory architecture rebuild. Start by reading:

1. /Users/edmundmitchell/factory/CLAUDE.md
2. /Users/edmundmitchell/factory/architecture rebuild 2026-04-17/06-handoffs/2026-04-17-rebuild-state.md
3. /Users/edmundmitchell/factory/architecture rebuild 2026-04-17/00-README.md

Then check relevant memory entries at /Users/edmundmitchell/.claude/projects/-Users-edmundmitchell-factory/memory/MEMORY.md.

Once you have context, ask me which of the 6 recommended next moves (in the handoff doc) I want to tackle, or suggest a different direction if you see one. Don't start implementing anything until we confirm the direction.

When firm decisions get made, log them to 03-decisions/decisions-log.md. When questions resolve, move them from open-questions.md to the log. When new audit or research is done, save reports to 04-audit/.

My working style: hybrid — conversation first, decisions and findings checkpointed to markdown files I review in the sidebar. Don't overexplain. Speed over money. Don't outbuild Anthropic.
```
