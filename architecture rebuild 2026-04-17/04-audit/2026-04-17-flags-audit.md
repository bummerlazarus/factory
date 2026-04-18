# Flags Audit — 2026-04-17

Sources reviewed:
- `gravityclaw/mcp_server.py` (deprecated monolith, 49 tools)
- `gravityclaw/mcp_companion.py`, `mcp_business.py`, `mcp_factory.py` (split servers)
- `gravityclaw/tools/registry.py` (unified tool registry — source of truth)
- `gravityclaw/tools/*.py` (individual tool implementations)
- Pinecone audit: `2026-04-17-pinecone-audit.md`

---

## Orphaned Tools

### 1. `notion_sync` — stub, no real implementation
**File:** `tools/notion_sync.py`
The `NotionSyncTool` is a Phase 1 skeleton that returns hardcoded mock data (`synced_tasks: 5`, two fake tasks). It never calls the Notion API, never writes to Pinecone, never writes to Supabase. The description says "sync Notion workspace data" but execution is a no-op. The registry exposes this as a live tool under the `business` tag.

### 2. `ingest_signals` — writes to `signals` namespace in Pinecone, which does not exist
**File:** `tools/ingest_signals.py`
When relevancy score is high, the tool attempts to embed signals into a `signals` Pinecone namespace. The Pinecone audit found no `signals` namespace — only `knowledge`, `conversations`, `content`, and four persona-memory namespaces. The Supabase write path (`signals` table) appears functional, but the Pinecone embed path silently fails (the code has a bare `except` that prints a warning and continues). Any semantic signal search against this namespace would return nothing.

### 3. `recalibrate_pinecone` — depends on `agent_retrieval_feedback` table that has no confirmed write path
**File:** `tools/recalibrate_pinecone.py`, `tools/registry.py`
This tool reads from `agent_retrieval_feedback` to find low-scoring chunks and re-embeds them. The write path to that table (recording per-query scores) is not visible in any registered MCP tool or ingest script — it would need to be written by the engine's retrieval path at query time. If that feedback loop isn't wired (no evidence it is in the exposed tools), this tool will always return "No low-score feedback entries found." It runs, but against an always-empty table.

### 4. `consolidate_memory` — depends on vector timestamps that don't exist in Pinecone
**File:** `tools/memory_consolidation.py`
This tool filters for vectors "older than N days" using an `ingest_date` or `last_updated` metadata field. The Pinecone audit explicitly flagged that **no `ingest_date` or `last_updated` field exists anywhere in the index** (Flag #8 in the audit). The consolidation tool would either skip everything or apply the wrong filter. Dead in practice.

### 5. `get_retrieval_stats` — same `agent_retrieval_feedback` dependency as `recalibrate_pinecone`
**File:** `tools/registry.py`
Calls `semantic_memory.get_retrieval_stats()` which reads from `agent_retrieval_feedback`. Same write-path problem as `recalibrate_pinecone` above. If the table has no rows, this always returns empty stats.

### 6. `record_decision` / `record_learning` — write to persona memory namespaces with no read path
**Files:** `tools/record_decision.py`, `tools/record_learning.py`
These tools write to per-persona Pinecone namespaces (`ceo-memory`, `developer-memory`, etc.) using a `channel="decisions"` or `channel="learnings"` metadata field. The Pinecone audit found these namespaces have only 2–10 vectors total and that all existing vectors are tagged `channel="context"` or `channel="attention"` — not `"decisions"` or `"learnings"`. No registered tool queries those channels. The write path works, but the data is never read back.

---

## Duplicate Tools

### 1. `get_notion_tasks` vs `read_notion_database`
Both query Notion databases. `get_notion_tasks` is an opinionated wrapper with a hardcoded map of 6 database names → IDs. `read_notion_database` accepts any `database_id` directly. They call the same Notion REST endpoint (`/v1/databases/{id}/query`) with the same auth pattern. The split is cosmetic (convenience alias vs. raw access), not functional. In the rebuild, one Notion MCP call covers both.

### 2. `ask_priestley` / `ask_hormozi` / `ask_channel`
All three are the same operation: `semantic_memory.query_memory(query, namespace="knowledge", filter_metadata={...})`. The only difference is the hardcoded filter. `ask_priestley` applies a channel_name filter. `ask_hormozi` applies a channel_name + author filter. `ask_channel` accepts the channel name as a param. `ask_priestley` and `ask_hormozi` are just pre-configured calls to `ask_channel`. All three could be replaced by a single Pinecone MCP `search-records` call with an appropriate filter.

### 3. `search_memory` vs `ask_channel` / `ask_priestley` / `ask_hormozi`
`search_memory` queries two namespaces (`conversations` + `knowledge`) with no filter. The `ask_*` tools query `knowledge` with a filter. They are semantically distinct but mechanically identical — both go to `semantic_memory.query_memory()`. In the rebuild, one parameterized Pinecone search replaces all four.

### 4. `schedule_task` / `list_scheduled_tasks` / `cancel_scheduled_task` vs Claude native scheduling
The scheduling trio reads/writes to a `scheduled_tasks` Supabase table and relies on a Vercel cron to evaluate it. This is a custom re-implementation of what Claude's native scheduled tasks feature now provides. Three tools doing what a platform feature handles natively.

### 5. `mcp_server.py` — entirely duplicates `mcp_companion.py` + `mcp_business.py` + `mcp_factory.py`
`mcp_server.py` is explicitly marked DEPRECATED at the top of the file. It exposes the same 49 tools as the combined surface of the three split servers. It is still runnable. Any session that accidentally connects to it will see double-registered tools. It should be deleted, not archived.

---

## Native MCP Replacements

### Pinecone MCP
These tools are thin wrappers over Pinecone REST calls. All can be deleted and replaced with direct Pinecone MCP calls (`search-records`, `upsert-records`, `describe-index-stats`):

| Tool | MCP replacement |
|---|---|
| `search_memory` | `search-records` (namespaces: `conversations` + `knowledge`) |
| `ask_priestley` | `search-records` with filter `channel_name in [...]` |
| `ask_hormozi` | `search-records` with filter on `channel_name` + `author` |
| `ask_channel` | `search-records` with filter `channel_name = X` |
| `capture_thought` | `upsert-records` to `knowledge` namespace |
| `prune_pinecone_memory` | Pinecone console or `delete` via SDK — not a day-to-day tool |
| `recalibrate_pinecone` | Drop entirely (feedback loop is unwired) |
| `consolidate_memory` | Drop entirely (timestamp metadata missing) |

### Supabase MCP
These tools do simple CRUD against Supabase tables with no business logic. All can be replaced with Supabase MCP `execute_sql` or direct table calls:

| Tool | Supabase MCP replacement |
|---|---|
| `get_core_facts` | `execute_sql` on `agent_core_memory` |
| `save_core_fact` | `execute_sql` upsert on `agent_core_memory` |
| `forget_core_fact` | `execute_sql` delete on `agent_core_memory` |
| `save_data` | `execute_sql` on `agent_data_store` |
| `query_data` | `execute_sql` on `agent_data_store` |
| `get_recent_activity` | `execute_sql` on `agent_activity_log` |
| `get_recent_messages` | `execute_sql` on `agent_messages` |
| `search_signals` | `execute_sql` on `signals` |
| `get_recent_signals` | `execute_sql` on `signals` |
| `get_youtube_videos` | `execute_sql` on `agent_youtube_videos` |
| `list_scheduled_tasks` | Drop — use Claude native scheduled tasks |
| `cancel_scheduled_task` | Drop — use Claude native scheduled tasks |
| `schedule_task` | Drop — use Claude native scheduled tasks |

### Notion MCP
Both Notion tools can be dropped in favor of the native Notion MCP:

| Tool | Notion MCP replacement |
|---|---|
| `get_notion_tasks` | `notion-query-database-view` or `notion-search` |
| `read_notion_database` | `notion-query-database-view` with `database_id` |
| `write_notion_page` | `notion-create-pages` |
| `notion_sync` | Drop entirely — it's a stub, and Notion MCP reads live |

### Firecrawl MCP
`firecrawl_scrape` is a 10-line wrapper over the Firecrawl API. The Firecrawl MCP already does this natively. Replace with direct MCP tool call.

---

## Missing Data Models

### 1. `signals` Pinecone namespace
`ingest_signals` writes to a `signals` namespace when relevancy ≥ 7. The namespace does not exist in the live index. High-relevance signals are embedded but never retrievable. The Supabase `signals` table exists and works; only the Pinecone side is missing.

### 2. `agent_retrieval_feedback` — write path never wired
The table `agent_retrieval_feedback` is referenced by `recalibrate_pinecone` and `get_retrieval_stats` for reading. The table presumably exists in Supabase, but no registered tool or engine call writes feedback rows to it at query time. The feedback loop (`query → score → feedback table → recalibrate`) is architecturally planned but not implemented at the tool layer.

### 3. `factory_sessions` / `factory_events` — RPC only, no direct table exposure
`update_factory_session` calls a Supabase RPC `log_factory_event` that presumably writes to `factory_sessions` and `factory_events` tables. These tables are referenced only through the RPC — their schema is opaque. No tool reads them back. The factory session state is write-only from the MCP side; you can only see it in the Mission Control dashboard (if it exists) or by querying Supabase directly.

### 4. `agent_data_store` — generic key-value store with no curated data
`save_data` / `query_data` write to `agent_data_store`. This is a generic scratch table with no schema enforcement beyond `key`, `value`, `data_type`. Nothing in the codebase pre-populates it or depends on data being there. It is an infrastructure placeholder, not a maintained data model.

### 5. Persona memory channels `decisions` and `learnings` — written but never read
`record_decision` and `record_learning` write to Pinecone persona namespaces using `channel="decisions"` and `channel="learnings"`. No tool queries by these channel values. The data model (channel as metadata filter) is defined only in the write tools, not in any retrieval tool.

---

## Priority Order for Migration

### Kill first (dead weight with no migration needed)

1. **`mcp_server.py`** — deprecated monolith, superseded by the split servers. Delete the file.
2. **`notion_sync`** — stub returning mock data. Delete the tool and its registration. Replace workflow with Notion MCP reads.
3. **`consolidate_memory`** — broken (no ingest_date field). Delete tool. Add ingest_date on rebuild if consolidation is still wanted.
4. **`recalibrate_pinecone` + `get_retrieval_stats`** — feedback loop is unwired. Delete both tools. If you want this pattern in the rebuild, wire the feedback write first.
5. **`record_decision` + `record_learning`** — write to a channel with no read path. Delete both tools. Persona memory in the rebuild should use a simpler, queryable scheme.
6. **`save_data` + `query_data`** — generic scratch store with no curated content. Drop in favor of Supabase MCP direct calls if needed.

### Migrate to native MCP next (drop custom tools, redirect to platform)

7. **`get_notion_tasks` + `read_notion_database` + `write_notion_page`** → Notion MCP. The hardcoded database ID map in `get_notion_tasks` is the only thing worth preserving — extract it as a reference doc.
8. **`search_memory` + `ask_priestley` + `ask_hormozi` + `ask_channel`** → Pinecone MCP `search-records`. Collapse four tools into parameterized calls.
9. **`schedule_task` + `list_scheduled_tasks` + `cancel_scheduled_task`** → Claude native scheduled tasks. The `scheduled_tasks` Supabase table and Vercel cron can be decommissioned.
10. **`get_core_facts` + `save_core_fact` + `forget_core_fact`** → Supabase MCP + Claude Projects memory. Core facts belong in Projects memory, not a custom Supabase table.
11. **`firecrawl_scrape`** → Firecrawl MCP directly.
12. **`get_recent_activity` + `get_recent_messages`** → Supabase MCP. These are read-only log queries; direct SQL is cleaner.

### Keep as Edge Functions (unique business logic worth preserving)

13. **`ingest_youtube_video` + `preview_youtube_ingest` + `youtube_sync`** — Non-trivial: transcript fetch, chunking, embedding, Supabase upsert. Worth porting to a Supabase Edge Function.
14. **`ingest_signals`** — RSS fetch + Gemini summarization + relevancy scoring + dual write (Supabase + Pinecone). Worth keeping as an Edge Function; fix the missing `signals` Pinecone namespace on rebuild.
15. **`publish_instagram_carousel` + `publish_instagram_post`** — 3-step Graph API flow. Keep as Edge Function behind an approval gate.
16. **`sync_youtube_comments`** — Gemini sentiment on comments. Edge Function candidate.
17. **`publish_to_beehiiv`** — Simple markdown-to-HTML + API push. Could be Edge Function or native MCP if Beehiiv gets one.
18. **`publish_to_vault`** — Supabase Storage upload + metadata upsert. Simplest to keep as a thin Edge Function.
19. **`generate_invoice` + `generate_pdf`** — Local file generation via PDF library. Edge Function if PDF generation is available server-side; otherwise keep as Claude Code tool only.
20. **`generate_voice`** — ElevenLabs API wrapper. One API call; keep as Edge Function if voice memos remain a use case.

### Deprioritize (functional but low signal)

21. **`update_factory_session`** — Useful infrastructure for the rebuild's own session tracking. Migrate the RPC to be readable as well (factory session dashboard). Low urgency.
22. **`hygiene_report` + `daily_briefing`** — Useful but these are read-only aggregations. Can be replaced by Claude reading Supabase MCP directly with a structured prompt.
23. **`suggest_skill` / `auto_skill`** — Meta-tool for workflow capture. Not needed in the rebuild's early phases.
24. **`system_heartbeat`** — Infrastructure probe. Keep as a minimal Edge Function ping.
25. **`file_reader` + `file_writer`** — Sandboxed local file access. Specific to the Railway deployment model. Drop in Claude-native rebuild; use Claude Code's own file tools.
26. **`ingest_instagram_content`** — Writes Instagram captions to Pinecone `knowledge` namespace. Low priority; no retrieval evidence this is used.
27. **`run_meeting`** — Reads a local SKILL.md file and returns it. Replace with a Claude Skill directly.
28. **`suggest_handoff`** — Internal routing signal between Cordis personas. The persona system is retired in the rebuild.
