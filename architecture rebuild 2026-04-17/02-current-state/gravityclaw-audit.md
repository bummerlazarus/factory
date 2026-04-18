# GravityClaw — Tool Audit

**Status:** Audited 2026-04-17. Full detail in `04-audit/2026-04-17-gravityclaw-tool-map.md` and `04-audit/2026-04-17-flags-audit.md`.

## Summary

- **Total registered tools:** 46 (across 3 active MCP servers + 1 deprecated monolith)
- **MCP servers:** `mcp_companion.py`, `mcp_factory.py`, `mcp_business.py` (active); `mcp_server.py` (DEPRECATED — still runnable)
- **Tool registry:** `tools/registry.py` (single source of truth for all servers)
- **Runtime:** Railway (Python)

## Tool inventory by destination

### Kill — dead weight, no migration needed (6 tools)

| Tool | Reason |
|---|---|
| `mcp_server.py` (entire file) | Deprecated monolith; re-registers all 46 tools as duplicates |
| `notion_sync` | Stub returning hardcoded mock data; never called Notion API |
| `consolidate_memory` | Broken — filters on `ingest_date` field that doesn't exist in Pinecone |
| `recalibrate_pinecone` | Feedback loop unwired — `agent_retrieval_feedback` table always empty |
| `get_retrieval_stats` | Same `agent_retrieval_feedback` dependency; always returns empty |
| `record_decision` + `record_learning` | Write to Pinecone `channel="decisions"/"learnings"` — no tool ever reads those channels |

### Replace with native MCP — Pinecone (5 tools → 1 parameterized call)

| Tool | Replacement |
|---|---|
| `search_memory` | Pinecone MCP `search-records` (namespaces: `conversations` + `knowledge`) |
| `ask_priestley` | Pinecone MCP `search-records` with channel filter |
| `ask_hormozi` | Pinecone MCP `search-records` with channel + author filter |
| `ask_channel` | Pinecone MCP `search-records` with channel_name param |
| `capture_thought` | Pinecone MCP `upsert-records` (+ Supabase MCP for activity log) |
| `prune_pinecone_memory` | Pinecone MCP or SDK delete call |

⚠️ **Caveat:** `gravity-claw` index is bring-your-own embeddings (3072-dim). Pinecone MCP data-plane tools only work on integrated indexes. Until the index is migrated to an integrated model, semantic search must go through an Edge Function using the SDK. See open question Q2.

### Replace with native MCP — Supabase (10 tools)

| Tool | Replacement |
|---|---|
| `get_core_facts` | Supabase MCP `execute_sql` on `agent_core_memory` |
| `save_core_fact` | Supabase MCP `execute_sql` upsert on `agent_core_memory` |
| `forget_core_fact` | Supabase MCP `execute_sql` delete on `agent_core_memory` |
| `save_data` | Supabase MCP `execute_sql` on `agent_data_store` |
| `query_data` | Supabase MCP `execute_sql` on `agent_data_store` |
| `get_recent_activity` | Supabase MCP `execute_sql` on `agent_activity_log` |
| `get_recent_messages` | Supabase MCP `execute_sql` on `agent_messages` |
| `search_signals` | Supabase MCP `execute_sql` on `signals` |
| `get_recent_signals` | Supabase MCP `execute_sql` on `signals` |
| `get_youtube_videos` | Supabase MCP `execute_sql` on `agent_youtube_videos` |

### Replace with native MCP — Notion (4 tools)

| Tool | Replacement |
|---|---|
| `get_notion_tasks` | Notion MCP `notion-query-database-view` |
| `read_notion_database` | Notion MCP `notion-query-database-view` |
| `write_notion_page` | Notion MCP `notion-create-pages` |
| `notion_sync` | Drop (stub) — Notion MCP reads live |

**Note:** Extract the hardcoded database ID map from `get_notion_tasks` as a reference doc before deleting.

### Replace with native MCP — Firecrawl (1 tool)

| Tool | Replacement |
|---|---|
| `firecrawl_scrape` | Firecrawl MCP directly |

### Replace with Claude native — scheduling (3 tools)

| Tool | Replacement |
|---|---|
| `schedule_task` | Claude native scheduled tasks |
| `list_scheduled_tasks` | Claude native scheduled tasks |
| `cancel_scheduled_task` | Claude native scheduled tasks |

### Keep as Supabase Edge Functions — unique business logic (10 tools)

| Tool | Why keep | Effort |
|---|---|---|
| `ingest_youtube_video` | Transcript fetch + chunking + embedding + dual-write | 4–6 h |
| `preview_youtube_ingest` | Pre-ingest check | 2–3 h |
| `youtube_sync` | Playlist sync + auto-ingest | 3–4 h |
| `sync_youtube_comments` | Gemini sentiment on comments | 2–3 h |
| `ingest_signals` | RSS + scoring + dual-write (fix missing Pinecone `signals` namespace) | 3–4 h |
| `publish_instagram_post` | 2-step Graph API flow | 2–3 h |
| `publish_instagram_carousel` | 3-step Graph API flow | 2–3 h |
| `get_instagram_posts` / `*_insights` / `*_account_insights` | Graph API reads + Supabase upsert | 2 h |
| `publish_to_beehiiv` | Markdown → HTML + beehiiv API | 1–2 h |
| `generate_voice` | ElevenLabs API | 1–2 h |
| `generate_pdf` / `generate_invoice` | PDF generation | 2–3 h |

### Deprioritize / confirm usage before deciding (6 tools)

| Tool | Notes |
|---|---|
| `update_factory_session` | Useful for Factory dashboard; migrate RPC to be readable too |
| `daily_briefing` | Replace with Claude scheduled task + Skill |
| `hygiene_report` | Replace with Claude reading Supabase MCP directly |
| `forget_video` | Useful but low priority |
| `ingest_instagram_content` | Low evidence this is used for retrieval |
| `publish_to_vault` | Confirm Vault is still active |
| `system_heartbeat` | No Railway to monitor post-rebuild |
| `suggest_skill` | Meta-tool; not needed in early rebuild phases |
| `file_reader` + `file_writer` | Railway-specific; Claude Code has native file tools |
| `run_meeting` | Replace with Claude Skill directly |
| `suggest_handoff` | Persona system retired in rebuild |

## Key flags

1. **`publish_to_beehiiv`** — `tools/beehiiv.py` does not exist. ImportError at runtime.
2. **`notion_sync`** — stub; silently returns fake data.
3. **`ingest_signals`** — writes to Pinecone `signals` namespace that doesn't exist; Pinecone write path silently fails.
4. **`ask_priestley`** — hardcoded allowlist of 14 channel names. Any new channel requires a code change. Fix: use metadata tags on ingest instead.
5. **`mcp_server.py`** — deprecated but still potentially the active Railway endpoint. All 46 tools are double-registered.
6. **4 ingest scripts** (`ingest_books.py`, `ingest_guides.py`, `ingest_reports.py`, `epub_ingest.py`) — exist in repo but NOT registered in `registry.py`. Standalone scripts; no MCP surface.

## Migration priority order

1. Kill dead tools (no migration needed)
2. Wire Notion MCP (already connected — zero effort)
3. Wire Firecrawl MCP
4. Wire Supabase MCP for read-only log/memory queries
5. Resolve Pinecone integrated-index question (Q2), then wire or Edge-Function-wrap semantic search
6. Port unique business logic to Edge Functions (YouTube, signals, Instagram)
7. Wrap scheduling as Claude scheduled tasks + Skills
8. Decommission Railway
