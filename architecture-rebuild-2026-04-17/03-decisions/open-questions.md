# Open Questions

Things not yet decided. Move to `decisions-log.md` once resolved.

---

## Q1. Migration style — piecewise vs. cutover?

Pull tools off Railway one by one (lower risk, longer timeline) vs. build fresh and cut over in one shot?

**Updated with audit data:** The split server architecture (`mcp_companion.py` / `mcp_factory.py` / `mcp_business.py`) already exists inside GravityClaw. Only the deprecated `mcp_server.py` monolith needs retiring. This makes **piecewise migration materially cheaper** — the isolation is already done.

**Leaning:** Piecewise. Do Phase 0.5 (security fixes) and Phase 1 (delete dead weight) first, those are risk-free.

---

## Q2. Vector strategy

**RESOLVED 2026-04-17.** Option (c) — consolidate to pgvector inside Supabase. Re-embed 14,491 vectors at 1536-dim with `text-embedding-3-small`, dual-read during cutover, retire Pinecone. See `decisions-log.md` entry "Q2 resolved: consolidate semantic search to pgvector in Supabase" and the memo at `04-audit/2026-04-17-q2-vector-strategy-memo.md`.

---

## Q3. Custom MCP server — keep one, or go zero?

The three split servers (`mcp_companion`, `mcp_factory`, `mcp_business`) already isolate concerns. After Phases 1–3, what remains as "unique logic" is all Edge Functions — no custom MCP needed.

**Leaning:** Zero custom MCP. Edge Functions + native MCPs + Claude Skills cover every non-dead tool.

---

## Q4. Dashboard scope for v1

**RESOLVED 2026-04-17.** See `decisions-log.md` entry "Dashboard: local prototype IS the production app (moved to /dashboard/)" (supersedes the earlier "Vercel-hosted, Supabase-backed" entry).

- Production dashboard = existing `/factory/dashboard/` codebase (formerly `local agent dashboard/`). ~8,400 lines of clean Next.js 16 / React 19 / TypeScript.
- Being migrated from filesystem I/O to Supabase — plan at `/dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md`.
- After migration: deployable to Vercel (or Tailscale self-hosted — see Q11).
- Agents still load from `COWORK_PATH` locally; Supabase agent storage is a future task.
- Architecture detail: `05-design/dashboard-architecture.md`.

---

## Q5. Schema audit — redesign first or inherit?

**RESOLVED by audit.** See `04-audit/2026-04-17-supabase-audit.md`. Concrete fix list now in `05-design/migration-plan.md` Phase 5:
- Standardize UUID generation (`gen_random_uuid()`)
- Fix `agent_messages` PK + add `session_id`
- Consolidate `research.status` columns
- Drop orphaned `scheduled_tasks`, `agent_habits`
- Add missing indexes on high-traffic tables
- Fix security issues (Phase 0.5)

Moving this to the decisions log once we confirm the fix list.

---

## Q6. Bring GravityClaw code into this repo?

Repo is at `/Users/edmundmitchell/gravityclaw/` (surfaced via the Pinecone audit).

**Leaning:** Clone to `/research/reference-repos/gravityclaw/` as read-only, matching the OB-1 pattern. Tool audit is already done so urgency is low.

---

## Q7. Multi-agent workflow shape

**RESOLVED 2026-04-17.** Six-agent troupe (Cordis/Axel/Hild/Lev working + Corva/Librarian meta), shared Supabase brain (no agent-to-agent chat), single approval UX at dashboard `/inbox/promotions`. MVP = Cordis + Corva + `/inbox/promotions` + Daily Recap. See `decisions-log.md` entry "Q7 resolved: six-agent troupe, shared Supabase brain, single approval UX" and the brainstorm at `04-audit/2026-04-17-q7-multi-agent-workflows-brainstorm.md`.

---

## Q8. Split Supabase into multiple projects?

**New from Supabase audit.** Current Supabase project holds three distinct product concerns:

- **Agent stack** — `agent_*` tables (memory, activity, messages, youtube, instagram, etc.)
- **CMS / website** — `posts`, `projects`, `research`, `products`, `services`, `lead_magnets`, `contact_submissions`
- **ZPM + Real+True app** — `rhythm_plans`, `rhythm_activities`, `suggested_activities`, `assessment_results`, `scorecard_responses`, `profiles`

Plus competitive intelligence (`competitors`, `content_items`, `signals`, etc.) and Digital Continent podcast (`dc_*`).

**Options:**
- (a) **Keep one project** — simpler; shared pool of connections and storage; no cross-project query complexity
- (b) **Split into 2** — separate agent stack from app/CMS data
- (c) **Split into 3+** — one per product concern

**Leaning:** (a) for now — the pain point isn't schema isolation, it's tool layer. But worth revisiting once Edmund has >1 paying ZPM / Real+True customer (RLS + noisy-neighbor concerns get real).

---

## Q9. Security holes — fix during rewire or separately?

**RESOLVED 2026-04-17.** Fixed as Phase 0.5. See `decisions-log.md` entry "Phase 0.5 security fixes applied".

All four migrations applied and verified:
- `scorecard_responses.public_update_scorecard` dropped
- `vault_files.anon_read_by_token` dropped
- `agent_conversations` and `agent_scratchpad` — RLS enabled

---

## Q11. Hosting & privacy model for the dashboard (Telegram lesson)

**RESOLVED 2026-04-17.** Option (a) — Vercel dashboard + chat, Supabase Auth + RLS, webhook for iPhone Shortcuts. No Telegram / Signal / Discord / WhatsApp ever. See `decisions-log.md` entry "Q11 resolved: own dashboard + chat on Vercel, no messaging gateways".

Decision grounded in the Hermes Agent audit (`04-audit/2026-04-17-hermes-agent-review.md`), which quantified the adapter tax per messaging platform (2914-line Telegram adapter, 16-point integration checklist). The failed Railway/Telegram attempt was the adapter cost, not Telegram.

---

## Q12. Circle provisioner — CLI-only, or Edge Function + dashboard button?

**Surfaced 2026-04-17** from the Circle audit + provisioning kit. Kit lives at `05-design/circle-provisioning/` as a Deno script that reads a JSON template and creates/updates the community via Admin API v2.

**Options:**
- (a) **Keep CLI-only** — simpler; Edmund runs `deno run provision.ts <template>` from his laptop when launching/updating a community.
- (b) **Port to Supabase Edge Function** — callable from dashboard ("Apply template"), schedulable, auditable via Supabase logs. Template lives in a `circle_templates` table.
- (c) **Both** — CLI for iteration, Edge Function for ops surface.

**Leaning:** (a) until ZPM relaunch is live, then reassess. The script is already Edge-compatible; porting is trivial when the need is concrete.

**Dependencies:** Needs a clean first real run (to verify image field names and space_group POST behavior) before any Edge Function work.

---

## Q10. Broader security hardening — when?

**Surfaced by Supabase security advisor during Phase 0.5 verification.** Out of Phase 0.5 scope but worth addressing before opening anything client-side.

**Issues:**

1. **RLS disabled on 7 tables** (competitive intelligence cluster): `signals`, `competitors`, `content_items`, `content_topics`, `topics`, `ai_analyses`, `scrape_runs`. Historically intentional for agent read access, but should have RLS + explicit policies.
2. **3 functions with mutable `search_path`**: `update_vault_files_updated_at`, `dc_set_updated_at`, `log_factory_event`. Minor risk; fix by setting `SECURITY DEFINER` + explicit `search_path`.
3. **Public storage bucket `media`** has a broad listing SELECT policy. May expose more than intended.
4. **Supabase Auth — leaked password protection disabled.** Enable in dashboard.
5. **Always-true INSERT policies** on public form tables (`contact_submissions`, `lead_magnet_submissions`, `waitlist`, `scorecard_responses`). Not strictly wrong — they're acceptable for public form submission — but worth adding input validation or rate limits.

**Leaning:** Do Q10 as a dedicated mini-phase before the dashboard goes public on Vercel. Not blocking for internal rewire work.
