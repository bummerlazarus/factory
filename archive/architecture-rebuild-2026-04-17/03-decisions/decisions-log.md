# Decisions Log

ADR-style record. One entry per firm decision. Add new entries at the top.

Format:
```
## YYYY-MM-DD — <short title>

**Decision:** <what was decided>
**Context:** <why this came up>
**Reasoning:** <the tradeoffs, what won, what lost>
**Consequences:** <what this enables or forecloses>
**Status:** active | superseded by <link>
```

---

## 2026-05-03 — Cost routing via OpenRouter (Haiku for cheap tier)

**Decision:** Route low-stakes Edge Function LLM calls through `_shared/models.ts` with three locked tiers — cheap=`anthropic/claude-haiku-4-5`, mid=`anthropic/claude-sonnet-4-6`, strong=`anthropic/claude-opus-4-7` — via OpenRouter. `curator_pass` becomes Haiku-drafts → Sonnet-reviews. `mixture` voters become [Haiku, Sonnet, Haiku] with Sonnet synth. `delegate` cheap. Dashboard `_shared/llm.ts` cheap tier flipped to Haiku (one line). OpenAI fallback (`gpt-4o-mini`) preserved.

**Context:** Audit on 2026-05-03 found three Edge Functions and dashboard's tier map were the easy-win surface. Spend was running ~$150–300/mo higher than necessary because every call hit Sonnet by default.

**Reasoning:** Two-stage curator_pass keeps the quality bar (Sonnet still reviews against an explicit ID allow-list, drops fake citations) while the bulk-read pass drops to Haiku. Mixture's odd voter loses no real quality vs. all-Sonnet because the synthesizer is still Sonnet. Allowlist guard regex (`/^(anthropic|openai)\/.+$|^google\/gemini-.+$/`) prevents env-var typos or compromise from silently routing to DeepSeek/Mistral. Caller-supplied model ids in `mixture` go through the same guard. Defaults baked into code, not Edge Function secrets — avoids the foot-gun where stale secrets win over a future code change.

**Consequences:** Estimated $150–300/mo saved. NOT routed: dashboard chat (`lib/anthropic.ts`), agent-runner main loop, audio transcription, signal classification — those need Sonnet. `MODEL_CHEAP/MID/STRONG` env vars exist as escape hatches but are unset by default. Forward-compat: changing the locked list requires Edmund's approval.

**Status:** active

---

## 2026-05-03 — Routing layer shipped: `table_registry` + `intent_router`

**Decision:** Land the routing layer described in `supabase/proposals/table-registry.md` (2026-04-26). Two new tables in `public`:
- `table_registry` (65 rows) — per-table metadata: `domain`, `layer`, `canonical_status`, `safe_for_default_retrieval`, `query_style`, `retrieval_notes`, `owner_intent[]`.
- `intent_router` (11 rows) — coarse intent label → `primary_tables[]` / `secondary_tables[]` / `forbidden_tables[]` / `query_style` / `required_filters jsonb`.

Migration `020_table_registry.sql` is the canonical schema + idempotent seed. The DB applied it as three sub-migrations on 2026-05-03 (`020_table_registry_and_intent_router`, `020b_seed_table_registry`, `020c_seed_intent_router`); the file consolidates them so a fresh `supabase db reset` reproduces live state.

**Context:** Memory is overloaded across six places (per `00-SYSTEM-INDEX.md`). Agents had no machine-readable answer to "is this table safe to query for this intent?" That gap caused two failure modes: (a) PII leakage risk on default retrieval, (b) name-collision queries (e.g. `projects` vs. `workstreams`). The proposal classified all 63→65 tables and proposed an intent vocabulary aligned with the multi-agent design from Q7.

**Reasoning:**
- Build the metadata layer before the enforcement layer. Once the registry exists, an Edge Function `route_query()` can refuse unsafe combinations and dashboards can read it for filtering.
- Idempotent seed (`ON CONFLICT DO UPDATE`) means re-running the migration keeps the registry current without manual intervention.
- New `meta` domain added (not in original proposal) for self-describing config tables (`table_registry`, `intent_router`). Keeps the vocabulary closed.
- 11 intents shipped verbatim from proposal. PII default-deny enforced as convention via `safe_for_default_retrieval=false`; not yet RLS-backed (deferred — see follow-ups).

**Consequences:**
- `route_query()` Edge Function and call-site refactor are now unblocked.
- `agent_retrieval_feedback` (now 18 rows, was 0 in proposal) is positioned for a self-improvement loop — feedback can demote `safe_for_default_retrieval` or surface forbidden_tables candidates. Wiring TBD.
- Drift detection still missing: tables added after 2026-05-03 will not auto-appear in `table_registry`. Audit script or `pg_event_trigger` needed.
- Proposal Part 5 step 5 (RLS-backed PII default-deny) is **not** done. Convention only.

**Follow-ups flagged:**
1. Build `route_query(intent, query, scope)` Edge Function.
2. Refactor existing retrieval call sites in `dashboard/` to go through `route_query`.
3. Wire `agent_retrieval_feedback` aggregation → router-improvement view (human-in-loop, not auto-mutation).
4. PII RLS hardening — needs design decision on the `app.pii_ok` GUC mechanism (per Edmund).
5. Drift-detection audit (nightly `information_schema.tables` diff against `table_registry.table_name`).
6. Re-classify `agent_retrieval_feedback` from `scratch` → `canonical` once it has a real consumer.

**Status:** active

---

## 2026-04-19 — W10 compression engine shipped

**Decision:** Ship the Wave 10 compression engine — shared LLM helper with tier routing + stochastic consensus, typed-link vocabulary, four new agents (Processor/Axum, Researcher/Sophia, Contradiction/Kontra, Permanent Gate/Kairos, IP Specialist/Augustin), upgraded `research-director-synthesis` to N=3 stochastic consensus, OpenRouter-first routing, and a `/compression` dashboard route. Dashboard commit `a519da3` on branch `feat/compression-engine`.

**Context:** Pillar 4 (self-improving loops) needed a compression layer — turning raw observations/themes/connections into tensions, contradictions, and permanent IP. Four design choices came up during the ship and are worth pinning down so later sessions don't relitigate them.

**Sub-decisions:**

1. **Relaxed the `reference_docs` CHECK constraint for `kind='tension'`.** Original plan required `source_id` + `target_id` on every typed link. Relaxed for `tension` only: the Processor surfaces memory↔memory tensions at CEQRC time, and memory rows aren't `reference_docs` — so endpoints live in `metadata.source_memory_id` / `metadata.target_memory_id` instead. Reference-doc-level tensions still use the strict columns. Tradeoff: two shapes of "tension" in the same table, distinguished by metadata presence. Accepted because a separate table would double the query surface for a one-off polymorphism.

2. **Augustin is a new agent, not a Corva scope extension.** The plan offered either. Edmund picked new agent: CEQRC ritual is convergent/dialogic Opus-tier work, distinct from Corva's divergent content drafting. Conflating them would muddy both system prompts. Cost: one more agent to maintain (adds to the expanding-team surface tracked in W8).

3. **N=3 starting consensus size, not N=5.** Research consensus is N=5 is the sweet spot for stochastic-consensus LLM output, but N=3 is enough to pilot disagreement detection. Keeps cost and latency lower during the shake-out period. Configurable via env var — bump to N=5 once the disagreement signal proves useful on real W10 output.

4. **OpenRouter-first routing in the shared `_shared/llm.ts` helper.** One key, many models across tiers (mid = `anthropic/claude-sonnet-4-6`, strong = `anthropic/claude-opus-4-7`, etc.). Fallback to direct OpenAI if OpenRouter is unavailable. Tradeoff: model slugs are OpenRouter-specific — if they rename, mid/strong tiers break until slugs are updated; the fallback path loses Claude entirely (OpenAI-only). Accepted because single-key simplicity beats multi-provider plumbing at current scale.

**Consequences:**
- Typed-link vocabulary (`source_id` / `target_id` columns on `reference_docs`) is now live and used by Processor output; other agents can link rows without adding bespoke metadata conventions.
- `research-director-synthesis` now calls the shared helper in N=3 consensus mode; per-function tier selection is env-configured.
- `/compression` dashboard route surfaces Approve/Dismiss for Kairos-escalated proposals. UI wiring across other surfaces (chat tools, `/research` kind extension, Ask Sophia button) is in flight as W10.10.
- W6.6 atomic-draft progressive rewrite cron deferred — holding to the rule-of-three before a fifth agent starts writing into `reference_docs`.

**Status:** active

---

## 2026-04-17 — W1.3 resolved: leave the stale cleanup commit in place

**Decision:** Edmund picks **leave** for W1.3. Local commit `5d32f83` (pre-agents-refactor tool-cleanup) stays on the local branch, unpushed. No micro-cleanup PR. Actual removal of `notion_sync` (stub) and `recalibrate_pinecone` (unwired feedback loop) deferred to W9.4 when GravityClaw is decommissioned.

**Context:** Re-audit of the 12-tool cleanup plan found 5 tools already deleted on remote by the agents-first refactor, 5 actively used by new agent roles (record_decision, record_learning, file_reader, file_writer, system_heartbeat), and 2 still maybe-dead. Pushing `5d32f83` as-is would break the agents-first refactor. Choices were drop+defer / drop+micro / leave.

**Reasoning:**
- No blast-radius cost: the stale commit is local-only, unpushed, and doesn't block any other epic.
- W9.4 will touch the whole GravityClaw surface anyway — cleanup is cheapest inside that pass.
- Speed-over-money — Edmund optimizing for forward motion, not branch hygiene.

**Consequences:**
- Local branch stays diverged from remote until W9.4. Acceptable — no one else pushes to this branch.
- `notion_sync` and `recalibrate_pinecone` keep living as dead code in GravityClaw until the whole MCP retires.
- Wave 1 foundation now fully wrapped from a decision standpoint; W1.4 still awaits 7 days of dual-read logs (no decision needed now).

**Status:** active

---

## 2026-04-17 — Q2 resolved: consolidate semantic search to pgvector in Supabase

**Decision:** Resolve Q2 toward option (c). Install `pgvector` on the Supabase project, create a `memory` table with `namespace`, `content`, `embedding vector(1536)`, `metadata jsonb`, build a `match_memory()` RPC for search, re-embed the 14,491 Pinecone vectors at 1536-dim with `text-embedding-3-small`, dual-read for 1–2 weeks, then retire Pinecone. Keep Pinecone live during cutover as a read replica.

**Context:** Q2 had three live options (a) Pinecone integrated index, (b) keep BYO Pinecone via SDK, (c) consolidate to pgvector. See the Q2 vector-strategy memo (`04-audit/2026-04-17-q2-vector-strategy-memo.md`).

**Reasoning:**
- `01-context/principles.md` already committed to "architect so consolidation to pgvector is a swap, not a rewrite." This is the moment to do the swap — before new Edge Functions start dual-writing to two stores.
- The Pinecone MCP's `upsert-records` / `search-records` tools don't work on the current BYO-embedding index. That removes Pinecone's main remaining advantage (native Claude tool calls). Once that's gone, pgvector wins on every axis except raw migration hours.
- 14K vectors with single-field filters is pgvector's sweet spot. HNSW at this scale is sub-50ms with recall indistinguishable from Pinecone.
- One source of truth: vectors + source rows share the same transactional boundary — drift-window gone.

**Consequences:**
- New Edge Functions (`capture()`, YouTube ingest, signals ingest) write to `memory` inside the same transaction as row writes. No two-system dance.
- Retires Pinecone vendor line once cutover verified.
- Follow-up Phase 2 migration: `CREATE EXTENSION vector;` + `memory` table + `match_memory()` RPC. Re-embed script lives at `/ops/scripts/migrate-pinecone-to-pgvector.ts` (one-shot, kept for reference).
- Drops the 5 near-empty persona-memory namespaces (rebuild in `agent_core_memory` / `agent_scratchpad`, non-vector). Dedups ~400 duplicate Priestley chunks during migration.
- Keeps one primary + one plugin slot (per earlier memory-provider policy). pgvector is now the plugin; Supabase remains primary.

**What would change this:** corpus grows to 500K+ vectors, multi-tenant vector-search for clients surfaces, or benchmarks on real query mix show p95 > 200ms. None apply today.

**Status:** active

---

## 2026-04-17 — Q7 resolved: six-agent troupe, shared Supabase brain, single approval UX

**Decision:** Resolve Q7. Four working agents (**Cordis** capture/chat, **Axel** content, **Hild** ops/client, **Lev** ingest/transcription) plus two meta (**Corva** end-of-session retro Skill, **Librarian** daily clustering Skill). All coordinate only through the shared Supabase brain (`sessions`, `work_log`, `observations`, `skill_versions`, `reference_docs`) — no agent-to-agent chat. Observations flow to `observations`; Corva drafts concrete `skill_versions` diffs at session close; Edmund approves in a single dashboard `/inbox/promotions` tab (Notion one-way mirror for mobile). Nothing auto-merges. Unreviewed proposals auto-expire at 14 days.

**Context:** Pillars 3 (SOPs-as-Skills), 4 (self-improving loops), 5 (proactive surfacing) all need a concrete agent shape. Open-questions Q7 had been unfilled since the workflows walkthrough. See brainstorm memo (`04-audit/2026-04-17-q7-multi-agent-workflows-brainstorm.md`).

**MVP (what ships first, days not weeks):**
1. **Cordis** — system prompt + tool allowlist, runs in CEO Desk project. Writes `sessions` + `work_log` + `observations`.
2. **Corva** (Skill) — fires at session close. Drafts one `skill_versions` proposal against `skills/voice-tone/SKILL.md`.
3. **Dashboard `/inbox/promotions` tab** — list + diff + approve/edit/reject. No Notion mirror yet.
4. **Daily Recap** (scheduled Skill) — 9pm, reads today's `work_log`, emails/Notions a 5-line summary with "N promotions waiting."

Exercises the full loop end-to-end. Add Lev next (voice memos = highest-pain capture), then Axel/Hild, then Librarian only if observation volume justifies clustering (>50/week).

**Consequences:**
- Phase 3 (`capture()` + Edge Functions) is scoped against these agent roles.
- Proactive surfacing Skills v1 set: Daily Recap, Last-Touched Heatmap, Goal Progress.
- Approval UX: single source of truth = dashboard `/inbox/promotions`. Notion = read-lite mirror later. Claude chat inline for one-off in-session approvals. No Slack-style for promotions.
- Locks the anti-patterns: no custom orchestration layer, no agent-to-agent chat as primary mechanism, no per-venture agents (venture = `work_log.project` metadata), no auto-approval thresholds.
- Skill versioning: double-write at approval time — row in `skill_versions` (audit/query path) + git commit in `/skills/<name>/` (portable Claude packaging).

**Open sub-questions** (tracked, not blocking MVP):
- Session scope — single Claude conversation vs. logical block spanning conversations (affects Corva's retro trigger).
- Observation write path — inline from Cordis (noisy/fresh) vs. consolidated at retro from Corva (clean/delayed). Leaning: both — Cordis writes `confidence ≤0.6` inline, Corva consolidates at close.
- `reference_docs` promotions — Corva proposes updates, but goal/value/KPI docs may deserve stricter gating than Skills.
- Librarian existence — may be premature before observation volume justifies (>50/week).
- ZPM vs. Real+True under Hild — single project or split.

**Status:** active

---

## 2026-04-17 — Circle Admin API v2 token secured; provisioning kit drafted

**Decision:** ZPM's Circle Admin API v2 token is stored in `ops/.env` as `CIRCLE_ADMIN_API_TOKEN`. A community-as-JSON provisioning kit is drafted at `05-design/circle-provisioning/` — template + Deno script that uploads cover images via `direct_uploads`, creates/updates spaces with full config (branding, visibility, locked-state copy, SEO tags, notifications, course settings), and writes `id-map.json` for idempotent reruns.

**Context:** Circle audit (`04-audit/2026-04-17-circle-audit.md`) confirmed the Admin API v2 exposes ~67 endpoints across 20 resource tags and the Space schema accepts full visual config — cover image (light/dark), custom emoji, lock-screen blocks, meta-tag attributes, course settings, notification defaults. Entire community setup is scriptable from a JSON template. This is high-leverage for upcoming relaunches across ZPM (and reusable for EM, FAI, Real+True, Digital Continent client communities).

**Reasoning:** Manual Circle setup doesn't scale to multiple community relaunches. A JSON template + one script means every relaunch is a diff, not a click-through. Idempotent reruns via `id-map.json` let Edmund iterate on branding/copy without destroying community state.

**Consequences:**
- Key lives alongside Supabase/Pinecone/Anthropic/Notion/Firecrawl in `ops/.env` — not in 1Password yet (follow-up) and not in Supabase secrets until we deploy the Edge Function version.
- Kit is a standalone Deno script for now; portable into a Supabase Edge Function later with minimal changes.
- Resolves the audit's open question on API token availability.
- Two unverified assumptions in the script (image request field names, space_group POST availability) will surface on first real run and need a one-line fix if wrong — `id-map.json` upload cache protects against re-upload churn.
- Flags Q12 (below): should the provisioner become an Edge Function + dashboard "apply template" button, or stay CLI-only?

**Status:** active

---

## 2026-04-17 — Q11 resolved: own dashboard + chat on Vercel, no messaging gateways

**Decision:** Resolve Q11 toward option (a). Build own dashboard + chat on Vercel, backed by Supabase (Auth + RLS + Edge Functions). No Telegram / Signal / Discord / WhatsApp / messaging-platform capture surfaces — ever. iPhone access = Claude iPhone app (primary) + Vercel URL (PWA) + webhook endpoint (iPhone Shortcuts, email forwarding, etc.).

**Context:** Q11 had been parked since the workflows walkthrough. The Hermes Agent audit (`04-audit/2026-04-17-hermes-agent-review.md`) quantified the cost of a messaging-platform adapter — `gateway/platforms/telegram.py` is 2914 lines of edge cases (UTF-16 truncation, reply/echo loops, backoff+jitter, phone redaction, bot-token connection conflicts), and `ADDING_A_PLATFORM.md` is a 16-point checklist *per platform*. The failed Railway/Telegram attempt was the adapter tax, not Telegram. Edmund's stated preference: no Telegram ever; build his own.

**Reasoning:** Vercel + Supabase Auth + RLS is well-understood, iPhone-reliable, and magic-link auth works across all of Edmund's surfaces. Tailscale self-hosted (option b) trades real operational overhead (home-box uptime, iPhone reachability, TLS) for privacy gains that don't matter when the data is owned end-to-end anyway.

**Consequences:**
- Dashboard ships on Vercel once the Supabase migration (`/dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md`) completes.
- No messaging-platform work ever enters rebuild scope. Hermes gateway pattern rejected.
- Q10 (broader security hardening) becomes blocking before the dashboard goes public.

**Status:** active

---

## 2026-04-17 — Adopt Claude SKILL.md format verbatim for /skills/

**Decision:** All Skills in `/skills/` use the Claude SKILL.md format — YAML frontmatter (`name` + `description`, ≤1024 chars) + markdown body + optional `references/`, `templates/`, `scripts/`, `assets/` subdirs. No forks, no custom format.

**Context:** Pillar 3 (SOPs-as-Skills) needs a format. Hermes Agent (`tools/skill_manager_tool.py:150-186`) adopted Anthropic's format rather than forking, and agentskills.io distributes in the same shape.

**Reasoning:** Zero cost. Works in Claude Projects + Claude Code + any future fallback runtime. Path-traversal safety falls out of the allowed-subdirs constraint.

**Consequences:**
- Phase 4 (Claude Skills) in `migration-plan.md` uses this format by default.
- Skills are portable across runtimes with no translation.

**Status:** active

---

## 2026-04-17 — Memory provider policy: one primary + one plugin slot

**Decision:** Architectural policy — **one primary memory provider + at most one external plugin provider** exposes tool schemas to the model at a time. Primary = Supabase MCP on `agent_core_memory` and friends (always on). Plugin slot = the single vector backend in use. Adding a second plugin = explicit architectural exception, not drift.

**Context:** Hermes Agent (`agent/memory_manager.py:83-141`) rejects a second external memory provider with a warning because stacked tool schemas degrade tool-call accuracy. The rebuild plan had three-provider thinking (Pinecone archive + Supabase structured + maybe pgvector) that would do exactly this.

**Reasoning:** One live retrieval path. Protected tool-schema surface. Collapses Q2's option space: (d) file-based is disqualified (file-based is the *primary*, not a plugin); the live contest is (a) integrated Pinecone vs (b) BYO-Pinecone-via-SDK-from-Edge vs (c) pgvector — same shape as Q2 already, just sharper.

**Consequences:**
- `capture()` Edge Function writes to primary always; to plugin only when the vector slot is enabled.
- Q2 reframes as "which plugin wins the slot" — see open-questions.md.
- Tool-schema surface exposed to the model is bounded.

**Status:** active

---

## 2026-04-17 — Phase 0.5 security fixes applied

**Decision:** Applied 4 migrations to the live Supabase project (`obizmgugsqirmnjpirnh`) closing the security holes flagged in the Supabase audit. All migrations succeeded and verified.

**Migrations applied:**
1. `phase_0_5_001_scorecard_responses_lock_update` — dropped `public_update_scorecard` policy (anyone could update any row)
2. `phase_0_5_002_vault_files_remove_anon_read` — dropped `anon_read_by_token` policy (leaked all vault metadata to anon)
3. `phase_0_5_003_agent_conversations_enable_rls` — RLS enabled on `agent_conversations`
4. `phase_0_5_004_agent_scratchpad_enable_rls` — RLS enabled on `agent_scratchpad`

SQL files stored in `05-design/phase-0-5-migrations/`.

**Verification:**
- All 4 target tables show `rls_enabled: true`
- Both bad policies confirmed removed from `pg_policies`
- Supabase security advisor no longer flags `agent_conversations` or `agent_scratchpad` as ERROR-level RLS-disabled
- New INFO-level advisors on the two newly-RLS'd tables ("RLS Enabled No Policy") are expected and benign — `service_role` has BYPASSRLS, so no explicit policy is needed; anon/authenticated are correctly denied by default

**Context:** Edmund gave explicit go-ahead to break existing anon access ("I'm the only one using it, and not right now"). If public share links need to return, implement via Supabase Storage signed URLs, not a re-enabled anon SELECT on the metadata table.

**Consequences:**
- Scorecard responses can no longer be updated anonymously (still publicly insertable; service role can update)
- `vault_files` metadata no longer readable by anon
- Agent conversation + scratchpad tables now require service_role access (Edge Functions / MCP with service key)
- Resolves Q9 in open-questions.md

**Follow-ups flagged but out of scope:**
- 7 more tables have RLS disabled (competitive intelligence cluster: `signals`, `competitors`, `content_items`, `content_topics`, `topics`, `ai_analyses`, `scrape_runs`)
- 3 functions have mutable `search_path`: `update_vault_files_updated_at`, `dc_set_updated_at`, `log_factory_event`
- Public storage bucket `media` has broad listing policy
- Supabase Auth leaked-password-protection disabled

These should be addressed in a dedicated "security hardening" phase. Adding as Q10.

**Status:** active

---

## 2026-04-17 — Dashboard: local prototype IS the production app (moved to /dashboard/)

**Decision:** The existing `local agent dashboard/` codebase is the production dashboard. Renamed and moved to `/dashboard/` within the factory monorepo. The Supabase migration plan replaces all filesystem I/O, making it deployable to Vercel.

**Context:** Code review of the prototype revealed ~8,400 lines of clean, production-quality Next.js 16 / React 19 / TypeScript code with full agent chat, workspace, Slack-style messaging, task inbox, and file browser already working. The only blocker for production was the iCloud/filesystem dependency — which the Supabase migration removes entirely.

**Reasoning:** Building a net-new dashboard would recreate all of that work for no gain. The constraint (iCloud/disk I/O) is being removed by the migration. One codebase, no duplication.

**Consequences:**
- `local agent dashboard/` is now `/dashboard/`. All references updated.
- Supabase migration plan lives at `/dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md`.
- Agents continue to load from COWORK_PATH (iCloud) locally; production will need agents stored in Supabase (future task).
- Factory monorepo structure is taking shape: `/dashboard /ops /production /supabase (future) /skills (future) /agents (future)`.

**Supersedes:** "Dashboard: Vercel-hosted, Supabase-backed (not the local prototype)" — 2026-04-17

**Status:** active

---

## 2026-04-17 — Inbox is a pipeline, not a place

**Decision:** A single `capture()` Supabase Edge Function is the canonical inbox backend. Three entry points flow into it: Claude chat (via MCP tool), the Vercel dashboard `/inbox` page, and a public webhook URL (for iPhone Shortcuts / email forwarding / Share Sheet / Slack / etc).

**Context:** User wants "one inbox to dump many different file types and prompts." The question was whether that's a chat UI, a website, or an agent — answer is: none of those. It's a pipeline.

**Reasoning:** Same write path → same data shape → same retrieval, regardless of entry point. UI is wherever you already are. No "open the inbox app" friction.

**Consequences:**
- One Edge Function to build, maintain, version.
- Each entry point is a thin caller, not a duplicate pipeline.
- Blob → Supabase Storage; metadata + pointer → Supabase tables; optional vector → pgvector/Pinecone; optional Notion card for triage.
- Workflows and capture types still need to be documented (`01-context/workflows-and-capture.md` — to fill via conversation).

**Status:** active

---

## 2026-04-17 — Supabase Realtime bridges Claude chat and the dashboard

**Decision:** Dashboard pages subscribe to Supabase Realtime channels so writes from Claude chat (or webhook, or anywhere else) appear instantly without refresh.

**Context:** User asked whether Claude chat could push to the live URL. Realtime is the native answer.

**Reasoning:** No polling, no custom WebSocket server, no sync logic. Works for any table we subscribe to.

**Consequences:** Dashboard listens on Realtime channels for inbox rows, task inbox, workspace items, activity log. Any surface writing via Supabase MCP or Edge Function triggers live UI updates. No client-side state reconciliation needed.

**Status:** active

---

## 2026-04-17 — Use Claude-native + native MCP as the default architecture

**Decision:** Retire GravityClaw. Rebuild around Claude platform features, native MCPs (Supabase, Pinecone, Notion, Firecrawl), and Supabase Edge Functions for unique logic. Custom MCP only as a last resort.

**Context:** GravityClaw (Railway-hosted custom MCP) has become a bottleneck — crashy, mixes concerns, impossible to maintain. Supabase and Pinecone now expose native MCP servers.

**Reasoning:** Edmund will not outbuild Anthropic. Anything the platform ships within 6 months we shouldn't build ourselves. Every custom piece is technical debt with a maintenance cost.

**Consequences:** Simpler. Fewer moving parts. Loses some bespoke ergonomics — acceptable trade.

**Status:** active

---

## 2026-04-17 — Six-folder repo discipline for the new build

**Decision:** Target repo structure is `/supabase /pinecone /skills /agents /dashboard /ops`. No mixing concerns.

**Context:** GravityClaw conflates agent configs, scripts, keys, MCPs, dashboard code. Root cause of the rebuild.

**Status:** active

---

## 2026-04-17 — Working notebook layout for planning phase

**Decision:** Use `architecture-rebuild-2026-04-17/` with numbered folders (00–06) as a living notebook until enough decisions are locked to move to implementation.

**Status:** active

---
