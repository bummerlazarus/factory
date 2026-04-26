# GravityClaw Tool Map — 2026-04-17

## Summary

**Total tools registered in `tools/registry.py`: 46**

| Category | Count | Tools |
|---|---|---|
| companion | 11 | search_memory, get_core_facts, capture_thought, save_core_fact, search_signals, get_recent_signals, get_notion_tasks, get_recent_activity, get_recent_messages, system_heartbeat, daily_briefing, forget_core_fact, suggest_handoff |
| factory | 14 | save_data, query_data, schedule_task, list_scheduled_tasks, cancel_scheduled_task, hygiene_report, file_reader, file_writer, prune_pinecone_memory, recalibrate_pinecone, publish_to_vault, suggest_skill, update_factory_session, consolidate_memory, get_retrieval_stats, record_decision*, record_learning* |
| business / content_ops / social / strategy | 21 | ask_priestley, ask_hormozi, ask_channel, read_notion_database, write_notion_page, notion_sync, firecrawl_scrape, ingest_signals, get_youtube_videos, preview_youtube_ingest, ingest_youtube_video, youtube_sync, sync_youtube_comments, forget_video, generate_pdf, generate_voice, get_instagram_posts, get_instagram_post_insights, get_instagram_account_insights, publish_instagram_carousel, publish_instagram_post, ingest_instagram_content, generate_invoice, run_meeting |
| untagged | 1 | publish_to_beehiiv |

*`record_decision` and `record_learning` are tagged both `business` and `factory`.

Note: `mcp_server.py` is **deprecated** (replaced by `mcp_companion.py`, `mcp_factory.py`, `mcp_business.py`). All three new servers pull from the same unified `tools/registry.py`.

---

## Tool Inventory

### search_memory
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** none (read-only Pinecone)
- **Pinecone namespaces:** `conversations`, `knowledge`
- **External APIs:** none
- **What it does:** Semantic search across both Pinecone namespaces, merges and re-ranks results by score.

---

### get_core_facts
- **File:** `tools/registry.py` (delegates to `engine.db_logger.get_all_facts`)
- **Supabase tables:** `agent_core_memory` (reads key-value facts)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Returns all durable key-value facts from Supabase core memory.

---

### capture_thought
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** `agent_activity_log` (writes a system event)
- **Pinecone namespaces:** `knowledge` (upserts via `upsert_knowledge`)
- **External APIs:** Google Gemini (embedding via `engine.semantic`)
- **What it does:** Saves a tagged thought to both Pinecone and the Supabase activity log.

---

### save_core_fact
- **File:** `tools/registry.py` (delegates to `engine.db_logger.save_fact`)
- **Supabase tables:** `agent_core_memory` (upsert by key)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Upserts a durable key-value fact in Supabase core memory.

---

### forget_core_fact
- **File:** `tools/forget_core_fact.py`
- **Supabase tables:** `agent_core_memory` (deletes by key)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Deletes a single key-value fact from Supabase core memory.

---

### save_data
- **File:** `tools/registry.py` (delegates to `engine.db_logger.save_data`)
- **Supabase tables:** `agent_data_store` (upsert)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Saves arbitrary key-value data to a Supabase key-value store (Tier 3 data).

---

### query_data
- **File:** `tools/registry.py` (delegates to `engine.db_logger.query_data`)
- **Supabase tables:** `agent_data_store` (select by key)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Retrieves a value from the Supabase data store by key.

---

### search_signals
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** `signals` (reads, filters by category/query, sorts by `relevancy_score`)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Searches the AI Signal Feed by keyword and/or category, ranked by relevancy score.

---

### get_recent_signals
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** `signals` (reads, sorts by `scraped_at`)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Returns the most recently scraped signals sorted by date rather than relevancy.

---

### ingest_signals
- **File:** `tools/ingest_signals.py`
- **Supabase tables:** `signals` (insert), `signal_source_health` (upsert)
- **Pinecone namespaces:** `signals` (upserts high-relevance items, score ≥ 60)
- **External APIs:** Google Gemini (gemini-2.5-flash for summarization + scoring), RSS feeds via `feedparser`, YouTube via `yt-dlp`
- **What it does:** Ingests RSS feed sources and YouTube channels into the Signal Feed, scores each item with Gemini, and embeds high-relevance items into Pinecone.

---

### get_recent_activity
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** `agent_activity_log` (reads, filters by type)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Returns recent agent tool calls, errors, heartbeats, and system events from Supabase.

---

### get_recent_messages
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** `agent_messages` (reads, ordered by `created_at`)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Returns recent conversation history between the user and Cordis.

---

### system_heartbeat
- **File:** `tools/system_heartbeat.py`
- **Supabase tables:** `agent_activity_log` (inserts a `heartbeat` type row)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Posts a heartbeat record to Supabase to confirm the system is alive.

---

### daily_briefing
- **File:** `tools/daily_briefing.py`
- **Supabase tables:** `agent_activity_log`, `agent_cost_log`, `scheduled_tasks` (all reads)
- **Pinecone namespaces:** none
- **External APIs:** `wttr.in` (weather), `rss2json.com` + CNN RSS (top news)
- **What it does:** Generates a JSON summary of the last 24 hours of activity, API costs, scheduled tasks, weather, and headlines.

---

### hygiene_report
- **File:** `tools/hygiene_report.py`
- **Supabase tables:** `agent_activity_log`, `agent_cost_log` (reads)
- **Pinecone namespaces:** all (calls `describe_index_stats`)
- **External APIs:** none
- **What it does:** Reports on disk usage (`.tmp`), activity log counts, API cost totals, and Pinecone namespace vector counts.

---

### ask_priestley
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** none
- **Pinecone namespaces:** `knowledge` (filtered by `channel_name` in a hardcoded allowlist)
- **External APIs:** Google Gemini (embedding)
- **What it does:** Semantic search over Daniel Priestley and associated channels' ingested YouTube content.

---

### ask_hormozi
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** none
- **Pinecone namespaces:** `knowledge` (filtered by `channel_name` or `author` = Alex Hormozi)
- **External APIs:** Google Gemini (embedding)
- **What it does:** Semantic search over Alex Hormozi's ingested YouTube videos and books.

---

### ask_channel
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** none
- **Pinecone namespaces:** `knowledge` (filtered by exact `channel_name`)
- **External APIs:** Google Gemini (embedding)
- **What it does:** Semantic search over any ingested YouTube channel by name.

---

### get_notion_tasks
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** Notion API (`api.notion.com/v1/databases/{id}/query`) — hardcoded database ID map (tasks, projects, sprints, sops, ideas, content)
- **What it does:** Queries a named Notion database and returns items with title and status.

---

### read_notion_database
- **File:** `tools/read_notion_database.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** Notion API (query by arbitrary database ID)
- **What it does:** Queries any Notion database by ID and returns formatted rows.

---

### write_notion_page
- **File:** `tools/write_notion_page.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** Notion API (creates a new page in a database)
- **What it does:** Creates a new page in a Notion database with title, body content, and optional properties.

---

### notion_sync
- **File:** `tools/notion_sync.py`
- **Supabase tables:** none (writes to `.tmp/notion_cache.json` locally)
- **Pinecone namespaces:** none
- **External APIs:** none (currently a **stub/mock** — returns hardcoded mock data, no real Notion API calls)
- **What it does:** Placeholder — returns mock sync data. No real implementation.

---

### preview_youtube_ingest
- **File:** `tools/youtube_ingest_preview.py` (via `tools/youtube_ingest.py`)
- **Supabase tables:** `agent_youtube_videos` (reads to check if already ingested)
- **Pinecone namespaces:** none (read-only preview)
- **External APIs:** YouTube Data API v3, `yt-dlp` (transcript download)
- **What it does:** Fetches video metadata and transcript word count for review before committing an ingest.

---

### ingest_youtube_video
- **File:** `tools/youtube_ingest.py`
- **Supabase tables:** `agent_youtube_videos` (upsert)
- **Pinecone namespaces:** `knowledge` (upserts chunked transcript vectors)
- **External APIs:** YouTube Data API v3, `yt-dlp` (transcript), Google Gemini (embedding)
- **What it does:** Downloads transcript via yt-dlp, chunks it, embeds via Gemini, upserts to Pinecone knowledge namespace, and records metadata in Supabase.

---

### youtube_sync
- **File:** `tools/youtube_sync.py`
- **Supabase tables:** `agent_youtube_videos` (upsert), `agent_activity_log` (log)
- **Pinecone namespaces:** `knowledge` (auto-ingest up to 2 new videos per run)
- **External APIs:** YouTube Data API v3 (playlist + video stats)
- **What it does:** Syncs all videos from the owned YouTube channel into Supabase and auto-ingests up to 2 new videos into Pinecone per run.

---

### sync_youtube_comments
- **File:** `tools/sync_youtube_comments.py`
- **Supabase tables:** `agent_youtube_videos` (reads owned videos), `agent_youtube_comments` (writes)
- **Pinecone namespaces:** none
- **External APIs:** YouTube Data API v3, Google Gemini (sentiment analysis)
- **What it does:** Fetches top comments on owned YouTube videos and writes them to Supabase with Gemini sentiment analysis.

---

### forget_video
- **File:** `tools/forget_video.py`
- **Supabase tables:** `agent_youtube_videos` (delete), `agent_youtube_comments` (delete)
- **Pinecone namespaces:** `knowledge` (deletes up to 1000 chunk IDs with pattern `{video_id}_chunk_N`)
- **External APIs:** none
- **What it does:** Purges a video from both Pinecone (all chunk vectors) and Supabase (video + comments rows).

---

### get_youtube_videos
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** `agent_youtube_videos` (reads)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Lists YouTube videos already synced into Supabase, optionally filtered by channel name.

---

### schedule_task
- **File:** `tools/schedule_task.py`
- **Supabase tables:** `agent_scheduled_tasks` (insert)
- **Pinecone namespaces:** none
- **External APIs:** Google Gemini (natural language → cron expression parsing)
- **What it does:** Creates a scheduled task in Supabase; Vercel cron evaluates it on a 15-minute cycle.

---

### list_scheduled_tasks
- **File:** `tools/schedule_task.py`
- **Supabase tables:** `agent_scheduled_tasks` (reads, filters by status)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Lists scheduled tasks from Supabase, filtered by status.

---

### cancel_scheduled_task
- **File:** `tools/schedule_task.py`
- **Supabase tables:** `agent_scheduled_tasks` (update status to cancelled)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Cancels a scheduled task by ID or partial description match.

---

### get_instagram_posts
- **File:** `tools/instagram.py`
- **Supabase tables:** `agent_instagram_posts` (upsert)
- **Pinecone namespaces:** none
- **External APIs:** Instagram Graph API v21.0 (`/{ig_id}/media`)
- **What it does:** Fetches recent Instagram posts and upserts them to Supabase with engagement data.

---

### get_instagram_post_insights
- **File:** `tools/instagram.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** Instagram Graph API v21.0 (`/{post_id}/insights`)
- **What it does:** Returns detailed engagement metrics (impressions, reach, saves, etc.) for a specific post.

---

### get_instagram_account_insights
- **File:** `tools/instagram.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** Instagram Graph API v21.0 (`/{ig_id}/insights`)
- **What it does:** Returns account-level Instagram analytics for a specified day range.

---

### publish_instagram_post
- **File:** `tools/instagram.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** Instagram Graph API v21.0 (2-step: create container → publish)
- **What it does:** Publishes a single image post to Instagram from a publicly-hosted URL.

---

### publish_instagram_carousel
- **File:** `tools/instagram.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** Instagram Graph API v21.0 (3-step: item containers → carousel → publish)
- **What it does:** Publishes a multi-image carousel post to Instagram from a list of public image URLs.

---

### ingest_instagram_content
- **File:** `tools/instagram.py`
- **Supabase tables:** `agent_instagram_posts` (upsert)
- **Pinecone namespaces:** `knowledge` (upserts post captions as vectors)
- **External APIs:** Instagram Graph API v21.0, Google Gemini (embedding)
- **What it does:** Pulls historical Instagram posts, stores them in Supabase, and embeds captions into Pinecone for semantic search.

---

### publish_to_beehiiv
- **File:** `tools/beehiiv.py` (**file missing from repo**)
- **Supabase tables:** none (presumed)
- **Pinecone namespaces:** none
- **External APIs:** beehiiv API (`BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID`)
- **What it does:** Converts markdown to HTML and creates a draft newsletter post in beehiiv.

---

### publish_to_vault
- **File:** `tools/registry.py` (inline implementation)
- **Supabase tables:** `vault_files` (insert/update), Supabase Storage bucket `vault` (upload)
- **Pinecone namespaces:** none
- **External APIs:** none (Supabase Storage only)
- **What it does:** Uploads a local file (html/pdf/svg/mp3) to Supabase Storage and records a shareable link in the `vault_files` table.

---

### firecrawl_scrape
- **File:** `tools/firecrawl_scrape.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** Firecrawl API
- **What it does:** Scrapes a URL via Firecrawl and returns clean markdown content.

---

### generate_pdf
- **File:** `tools/generate_pdf.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** none (local library, likely `weasyprint` or `reportlab`)
- **What it does:** Converts markdown content to a PDF file and returns the local file path.

---

### generate_invoice
- **File:** `tools/generate_invoice.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** none (local PDF generation)
- **What it does:** Generates a PDF invoice with client name, services, amount, tax, and due date.

---

### generate_voice
- **File:** `tools/generate_voice.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** ElevenLabs API (`/v1/text-to-speech/{voice_id}`, model: `eleven_monolingual_v1`)
- **What it does:** Generates an MP3 audio file from text using ElevenLabs TTS.

---

### file_reader
- **File:** `tools/file_reader.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Reads an approved, sandboxed project file by key (e.g., `known_issues`, `gemini`, `soul`).

---

### file_writer
- **File:** `tools/file_writer.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Appends or replaces sections in an approved project file, with automatic backup.

---

### prune_pinecone_memory
- **File:** `tools/prune_pinecone_memory.py`
- **Supabase tables:** none
- **Pinecone namespaces:** any (caller specifies; default `conversations`)
- **External APIs:** none
- **What it does:** Deletes a single Pinecone vector by its ID.

---

### recalibrate_pinecone
- **File:** `tools/recalibrate_pinecone.py` (via `tools/registry.py`)
- **Supabase tables:** `agent_retrieval_feedback` (reads low-score entries)
- **Pinecone namespaces:** `knowledge` (updates vector metadata)
- **External APIs:** Google Gemini (generates improved metadata suggestions)
- **What it does:** Finds low-scoring retrieval feedback entries and uses Gemini to improve the Pinecone vector metadata for better discoverability.

---

### consolidate_memory
- **File:** `tools/memory_consolidation.py`
- **Supabase tables:** `agent_retrieval_feedback` (reads usefulness flags)
- **Pinecone namespaces:** any (caller specifies; default `knowledge`)
- **External APIs:** Google Gemini (gemini-2.5-flash, cluster summarization)
- **What it does:** Clusters old Pinecone vectors by cosine similarity, summarizes each cluster via Gemini, deletes low-value originals, and upserts the summary vector.

---

### get_retrieval_stats
- **File:** `tools/registry.py` (inline, delegates to `engine.semantic.get_retrieval_stats`)
- **Supabase tables:** `agent_retrieval_feedback` (reads)
- **Pinecone namespaces:** any (caller specifies)
- **External APIs:** none
- **What it does:** Returns retrieval quality stats (usefulness rates, most/least retrieved vectors) from the feedback table.

---

### suggest_skill
- **File:** `tools/auto_skill.py`
- **Supabase tables:** `agent_activity_log` (reads recent sessions to find multi-tool runs)
- **Pinecone namespaces:** none
- **External APIs:** Google Gemini (drafts SKILL.md content)
- **What it does:** Analyzes recent activity for qualifying multi-tool sessions and drafts a reusable SKILL.md.

---

### update_factory_session
- **File:** `tools/update_factory_session.py`
- **Supabase tables:** `factory_sessions` + `factory_events` (via `log_factory_event` RPC, atomic upsert + append)
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Records work stream status (active/blocked/completed) and appends a checkpoint event via a Supabase RPC.

---

### run_meeting
- **File:** `tools/registry.py` (inline, reads `.agent/skills/meeting/SKILL.md`)
- **Supabase tables:** none (logs result to Notion Meetings per skill instructions)
- **Pinecone namespaces:** none
- **External APIs:** Notion API (via the skill's own steps, not directly in this tool)
- **What it does:** Activates the Weekly Tactical Meeting skill by returning the SKILL.md instructions to the LLM.

---

### record_decision
- **File:** `tools/record_decision.py`
- **Supabase tables:** none
- **Pinecone namespaces:** persona-specific namespace (e.g., `persona_content`, `persona_research`) — `decisions` channel
- **External APIs:** Google Gemini (embedding)
- **What it does:** Records a structured decision to a persona's Pinecone memory namespace.

---

### record_learning
- **File:** `tools/record_learning.py`
- **Supabase tables:** none
- **Pinecone namespaces:** persona-specific namespace — `learnings` channel
- **External APIs:** Google Gemini (embedding)
- **What it does:** Records a structured learning to a persona's Pinecone memory namespace.

---

### suggest_handoff
- **File:** `tools/suggest_handoff.py`
- **Supabase tables:** none
- **Pinecone namespaces:** none
- **External APIs:** none
- **What it does:** Validates a persona ID and returns a handoff suggestion string; the frontend extracts it to route to a specialist agent.

---

## Flags

### 1. Missing implementation file
- **`publish_to_beehiiv`** — `tools/registry.py` imports `from tools.beehiiv import publish_to_beehiiv` but `tools/beehiiv.py` does not exist anywhere in the repo. This tool will throw an `ImportError` at runtime.

### 2. Stub / mock tool
- **`notion_sync`** — `tools/notion_sync.py` returns hardcoded mock data (`synced_tasks: 5`) with no real Notion API call. It has been a stub since Phase 1 and was never implemented. Any call to this tool silently succeeds with fake data.

### 3. Orphaned ingest scripts with no MCP exposure
- `tools/ingest_books.py`, `tools/ingest_guides.py`, `tools/ingest_reports.py`, `tools/epub_ingest.py` — all exist but are **not registered** in `tools/registry.py` and have no MCP tool definitions. They appear to be standalone scripts run manually. Books/guides content may be in Pinecone (`knowledge` namespace) but there is no MCP surface to re-ingest or manage it.

### 4. Tools replaceable by native MCP calls
The following tools exist solely to wrap APIs that now have native MCP servers available in the new stack:

| Tool | Current approach | Native replacement |
|---|---|---|
| `get_notion_tasks` | Custom HTTP call to Notion REST API | Native Notion MCP |
| `read_notion_database` | Custom HTTP call to Notion REST API | Native Notion MCP |
| `write_notion_page` | Custom HTTP call to Notion REST API | Native Notion MCP |
| `notion_sync` | Stub (no real impl) | Native Notion MCP |
| `firecrawl_scrape` | Custom wrapper around Firecrawl API | Native Firecrawl MCP |
| `search_memory` / `ask_priestley` / `ask_hormozi` / `ask_channel` | Custom Pinecone queries | Native Pinecone MCP |
| `prune_pinecone_memory` | Custom Pinecone delete | Native Pinecone MCP |

### 5. Hardcoded channel filter in `ask_priestley`
The `ask_priestley` tool has a hardcoded allowlist of 14 channel names baked into `tools/registry.py`. This is brittle — any new Priestley-adjacent channel requires a code change. In the rebuild this should be a metadata tag on ingest rather than a hardcoded filter.

### 6. `run_meeting` has no data backing
`run_meeting` simply reads a local SKILL.md file and returns it as a string. It does not interact with any data store. Meeting results are logged to Notion only if the LLM subsequently calls `write_notion_page` — there is no direct write in the tool itself.

### 7. Deprecated `mcp_server.py` still live
`mcp_server.py` is explicitly marked deprecated in its own docstring but is still the file most likely configured as the active Railway endpoint. All 46 tools are re-registered inline in that file as one-liner delegations to the registry — meaning every tool exists in two registration paths. The split into `mcp_companion/factory/business.py` is complete architecturally but the cutover to production may not have happened.
