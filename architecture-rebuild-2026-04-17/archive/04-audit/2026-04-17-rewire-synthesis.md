# Supabase + Pinecone + Notion Rewire Synthesis

**Date:** 2026-04-17
**Scope:** Retire GravityClaw on Railway; move Supabase / Pinecone / Notion interactions onto native MCPs + Claude platform features + Supabase Edge Functions.
**Guiding principle:** Will not outbuild Anthropic.

---

## 1. Native capabilities cheat-sheet

### Supabase MCP (official)
- **Exposes:** SQL exec, table CRUD, schema inspection, migration gen/apply, Edge Function mgmt (deploy/invoke/list), project settings. 20+ tools.
- **Auth:** OAuth at `https://mcp.supabase.com/mcp` (recommended) or local CLI.
- **Limits:** Best for dev/staging (agent SQL on prod is dangerous). One project per connection. RLS off by default on new tables.
- **Refs:** `research/tool-guides/databases/supabase-overview-2026-04-16.md`

### Pinecone MCP (official — three servers)
- **Developer MCP:** `list-indexes`, `describe-index`, `describe-index-stats`, `create-index-for-model` (integrated only), `upsert-records`, `search-records`, `cascading-search`, `rerank-documents`.
- **Assistant MCP (local / remote):** chat/context over Pinecone Assistant.
- **Auth:** API key.
- **Limits:** MCP data-plane tools work on **integrated indexes only** (text-only, built-in embedding). Standard/pod indexes need CLI (`pc`) or SDK. Cascading search burns credits faster.
- **Refs:** `research/tool-guides/databases/pinecone-overview-2026-04-16.md`

### Notion MCP (hosted, recommended)
- **Exposes:** universal search (semantic), fetch/create/update pages, DB queries, comments.
- **Auth:** OAuth — one-click from Claude Desktop.
- **Limits:** No bulk operations via MCP (single page at a time). Search is semantic, not full-text. Self-hosted server is legacy; hosted is preferred.
- **Refs:** `research/tool-guides/other-tools/notion-overview-2026-04-16.md`

### Firecrawl MCP (official)
- **Exposes:** `scrape`, `search`, `crawl`, `map`, `/interact`, `/agent`.
- **Auth:** API key.
- **Limits:** `/agent` and `/interact` are cloud-only. Credit model is strict (Free = 500 credits total; Hobby = 3,000/mo). Rate limits are per-team.
- **Refs:** `research/tool-guides/research-tools/firecrawl-overview-2026-04-16.md`

---

## 2. Claude platform capabilities

### Scheduled tasks (native)
- Pro: 5/day; Max: 15/day; Enterprise: 25/day.
- `/schedule` in Claude Code, or `claude.ai/code/routines` UI.
- Runs on Anthropic cloud (not Edmund's laptop) — always-on.
- **Replaces:** `schedule_task`, `daily_briefing`, `hygiene_report`.

### Skills (native markdown + auto-discovery)
- `.md` files with YAML frontmatter, saved to `~/.claude/skills/` or as plugins.
- Auto-trigger based on task descriptions.
- Portable, version-controllable; no custom MCP needed.
- **Replaces:** `ask_channel`, `ask_priestley`, `ask_hormozi`, `run_meeting`, `suggest_skill`.

### Projects (Claude.ai + Cowork)
- Persistent workspaces with custom instructions + knowledge files.
- Claude.ai Projects = cloud, conversation-driven, team-shared.
- Cowork Projects = desktop, autonomous task execution, local folder access.
- **Complements** Skills for encoding personas (CEO Cowork, etc.), but project memory is conversational — still need Supabase for facts.

### Connectors (MCP-native)
- 50+ pre-built (Google Drive, Slack, GitHub, Notion) + custom MCP.
- In-app Customize menu or `.claude/settings.json` `mcpServers` key.

### Supabase Edge Functions (not Claude, but native to our stack)
- TypeScript on Deno, globally distributed, HTTP or Supabase-event triggered.
- Cold starts ~100–200ms.
- **Replaces:** YouTube ingest, signal ingest, Instagram publish, voice/PDF/invoice gen, `capture_thought` dual-writes.

---

## 3. Rewire opportunities — ranked

### Tier 1 — low risk, high confidence (do first)

| GravityClaw tool | Native replacement | Effort |
|---|---|---|
| `get_core_facts`, `save_core_fact`, `forget_core_fact` | Supabase MCP on `core_facts` | 30 min |
| `get_recent_messages`, `get_recent_activity` | Supabase MCP on `conversation_messages`, `agent_activity` | 30 min |
| `search_memory` | Pinecone MCP `search-records` (but see §4 — current index is bring-your-own, not integrated) | 15 min → or migration needed |
| `firecrawl_scrape` | Firecrawl MCP | 10 min |
| Notion reads/writes | Notion MCP (already wired) | 0 min |

**Why first:** No new infrastructure. No data migrations (except Pinecone caveat). Just wire and disable GravityClaw one-by-one.

### Tier 2 — medium risk, requires Edge Functions

| Tool | Replacement | Effort |
|---|---|---|
| `capture_thought` | Edge Function (dual-write Supabase + Pinecone) | 2–3 h |
| `ingest_youtube_video` | Edge Function + youtube-transcript | 4–6 h |
| `ingest_signals` | Edge Function + Firecrawl/RSS | 3–4 h |
| Instagram ingest/publish | Edge Function (Graph API) | 3–4 h |
| `generate_voice` / `_pdf` / `_invoice` | Edge Functions (ElevenLabs / PDFKit / Stripe) | 2–3 h each |

### Tier 3 — scheduling (parallel to Tier 2)

| Tool | Replacement | Effort |
|---|---|---|
| `daily_briefing`, `hygiene_report` | Claude scheduled task calling a Skill | 1–2 h |
| `schedule_task` family | Claude Skill wrapping native scheduling | 2–3 h |

### Tier 4 — Skill-wrapped (later)

| Tool | Replacement | Effort |
|---|---|---|
| `ask_channel` / `ask_priestley` / `ask_hormozi` | Claude Skill with Pinecone MCP query | 2–3 h each |
| `run_meeting` | Claude Skill | 1–2 h |
| `suggest_skill` | Claude Skill | 2–3 h |

### Tier 5 — audit and kill

| Tool | Reason |
|---|---|
| `file_reader` / `file_writer` | Claude Code has native Read/Edit/Write |
| `publish_to_vault` | Confirm Vault is still used |
| `recalibrate_pinecone` / `prune_pinecone_memory` | Ops scripts, move to `/ops/scripts/` |
| `update_factory_session` | Confirm Factory still active |
| `system_heartbeat` | No Railway to monitor |
| `publish_to_beehiiv` / `forget_video` | Confirm usage |

---

## 4. Gotchas to watch

### Pinecone — **important**
The current `gravity-claw` index is **bring-your-own embeddings** (3072-dim, OpenAI `text-embedding-3-large`). Pinecone MCP's data-plane tools (`upsert-records`, `search-records`) work on **integrated indexes only** (text-only, built-in embedding). See audit at `04-research/2026-04-17-pinecone-audit.md`.

**Implication:** To use Pinecone MCP directly, Edmund needs to either:
- (a) Migrate the corpus to a new integrated index with a Pinecone-hosted embedding model (`llama-text-embed-v2` or `multilingual-e5-large`). Requires re-embedding all 14,491 vectors. Trade-off: lose OpenAI embedding semantics; gain native MCP tool calls.
- (b) Keep current index and call Pinecone from an Edge Function using the SDK (no MCP). MCP only usable for metadata ops (`describe-index-stats`, etc.).
- (c) Dual-run — add an integrated index alongside for new content; keep `gravity-claw` for archival search via SDK.

This is a real decision. See `03-decisions/open-questions.md` Q2 (vector strategy).

### Supabase
- **RLS off by default** on new tables. Set explicit policies or everything is exposed.
- **MCP on production is risky.** Use dev project for rewire work; Edge Functions (not agents) touch prod.
- **Edge Functions can't hot-reload.** Redeploy via `supabase functions deploy`.

### Notion
- **No bulk create/update via MCP.** Use Notion API directly from an Edge Function for batch sync.
- Hosted MCP is the only forward path; self-hosted is legacy.

### Claude platform
- **Scheduled tasks run on Anthropic cloud** — can't touch local files directly. Use Supabase Storage for artifacts.
- **Skills aren't for secrets** — API keys go in `.env` or client settings, not in the Skill markdown.
- **Connectors cost tokens.** Notion semantic search, Slack reads, etc., consume tokens on every call.

### Firecrawl
- Free = 500 credits total (one-time). Budget before scaling. Rate limits are per-team.

### Edge Functions
- Postgres connections are pooled — good for throughput.
- No built-in Datadog/Sentry; OpenTelemetry available (April 2026).

---

## 5. Suggested 3-week sprint

### Week 1 — audit + read-path rewire
- **Days 1–2:** Read-only audits complete for Supabase, Pinecone (done — see `04-research/2026-04-17-pinecone-audit.md`), Notion. Grep GravityClaw tool usage.
- **Days 3–5:** Tier 1 read-path rewire — Supabase MCP, Pinecone MCP (with §4 caveat), Firecrawl MCP, Notion MCP. Test on all surfaces. Disable GravityClaw equivalents one at a time. Railway still running as fallback.
- **Days 6–7:** Dry-run.

### Week 2 — Edge Functions + Tier 2
- **Days 1–2:** Port `capture_thought` to Edge Function. Local serve → deploy → verify.
- **Days 3–5:** Port ingests (YouTube, signals, Instagram) + content gen in parallel.
- **Days 6–7:** Integration test.

### Week 3 — scheduling + Skills + cutover
- **Days 1–2:** Claude scheduled tasks for `daily_briefing`, `hygiene_report`. Verify cloud execution.
- **Days 3–4:** Wrap Tier 4 tools as Skills. Test auto-discovery.
- **Days 5–6:** Final integration across all surfaces.
- **Day 7:** Decommission Railway.

---

## 6. Feature ideas unlocked by the new architecture

1. **Supabase Realtime → Skills/Cowork.** Subscribe to table changes; when a new video ingests, trigger a Notion update + notification. Event-driven without queues.
2. **Pinecone integrated indexes with hosted embeddings.** If we migrate (§4), skip the OpenAI embedding step — fewer API calls, lower cost at scale.
3. **Multi-tenant cron via Supabase Cron extension.** Data-layer jobs (cleanup, sync) that don't require an agent session.
4. **Cowork for non-technical teammates.** Read-only Notion + Supabase access via scoped MCP. Democratizes the agent layer.
5. **Notion API for batch ops.** MCP for interactive reads; Edge Function + API for monthly reconciliation writes. Hybrid approach.
6. **Extensions-as-ventures model** (from OB-1 review). Per-venture Edge Functions + schemas + Skills + metadata. Isolated, composable.

---

## 7. Success criteria (exit conditions)

- [ ] All Tier 1 read paths via native MCP
- [ ] All Tier 2 write paths via Edge Functions
- [ ] Scheduled tasks run autonomously on Anthropic cloud
- [ ] Tier 4 Skills discoverable and working
- [ ] GravityClaw MCP not called in any session (verify via logs)
- [ ] 1-week production monitoring with no anomalies
- [ ] Railway decommissioned or archive-only

**Time estimate:** 15–20 focused hours, 3 weeks part-time with parallelization.

---

## Summary

Edmund's principle — *will not outbuild Anthropic* — is **fully supported** by the April 2026 native MCP ecosystem plus Claude platform features. Supabase MCP, Pinecone MCP (with the integrated-index caveat), Notion MCP, and Firecrawl MCP eliminate ~80% of GravityClaw's responsibility. Edge Functions handle the remaining 20%. Scheduled tasks and Skills cover automation without a custom MCP server.

**The rewire is not a rebuild — it's a decommission.** Move fast, test continuously, decommission Railway by end of Week 3. Target stack: **Supabase (structured) + Pinecone (vectors) + Notion (surface) + Claude (agent) + Vercel (dashboard)**, glued by native MCPs and Edge Functions.

The biggest open question is Pinecone's integrated-vs-bring-your-own index (§4). That decision blocks Tier 1 read-path work on semantic search.
