# Pinecone Audit — 2026-04-17

## Summary

- **Total indexes:** 1 (`gravity-claw`)
- **Total vectors:** 14,491
- **Embedding model:** Unknown bring-your-own (3072 dimensions — matches `text-embedding-3-large` from OpenAI)
- **Hosting:** Serverless, AWS us-east-1
- **Namespaces:** 8

Key observations:
- Everything lives in a single index with namespaces for separation. Clean architecture.
- `knowledge` (14,050 vectors) is the dominant corpus — contains YouTube transcripts, books, Notion pages, work logs, and various guides/briefs.
- `conversations` (211 vectors) matches the ~211 Cordial Catholics videos cited in the handoff; likely conversation memory, not video transcripts.
- `content` (209 vectors) is a competitor intelligence namespace (FOCUS, YDisciple scraped content), not Edmund's own content.
- Agent persona memory namespaces (`ceo-memory`, `developer-memory`, `content-memory`, `marketing-memory`, `cordis-memory`) are sparse (2–10 vectors each) — short-term contextual memory, not durable knowledge.
- Pinecone MCP plugin was not configured with an API key. Audit was performed via direct REST API using the key from `/Users/edmundmitchell/gravityclaw/.env`.

---

## Index: gravity-claw

- **Dimensions:** 3072
- **Metric:** cosine
- **Spec:** Serverless — AWS us-east-1
- **Host:** `gravity-claw-zi9052e.svc.aped-4627-b74a.pinecone.io`
- **Status:** Ready
- **Total vectors:** 14,491
- **Embedding type:** Bring-your-own (3072-dim = OpenAI `text-embedding-3-large`)
- **Integrated embedding:** No

### Namespaces

| Namespace | Vector Count | Purpose |
|---|---|---|
| `knowledge` | 14,050 | Primary corpus: books, YouTube transcripts, Notion, guides, work logs, briefs |
| `conversations` | 211 | Short-term conversation memory (msg_ prefix, timestamp-based IDs) |
| `content` | 209 | Competitor content intelligence (FOCUS, YDisciple) |
| `cordis-memory` | 10 | Cordis persona contextual memory |
| `ceo-memory` | 4 | CEO persona contextual memory |
| `developer-memory` | 3 | Developer persona contextual memory |
| `content-memory` | 2 | Content persona contextual memory |
| `marketing-memory` | 2 | Marketing persona contextual memory |

---

### Namespace: `knowledge`

The main corpus. 14,050 vectors across many corpora types, identified by ID prefix:

**YouTube transcripts (`yt_` prefix)**
- ~200+ video chunks from Cordial Catholics and Zealous Parish Ministers channels
- Chunk size: variable (many chunks per video)
- ID format: `yt_{video_id}_chunk_{n}`

**Books (`book_` prefix) — identified titles:**
- Alex Hormozi: *$100M Leads*, *$100M Money Models*, *$100M Offers*
- Daniel Priestley: *24 Assets*, *Entrepreneur Revolution* (2 editions), *Key Person of Influence*, *Lifestyle Business Playbook*, *Oversubscribed*, *Scorecard Marketing*
- Will Storr: *A Story Is a Deal*, *The Heretics*, *The Science of Storytelling*
- Adam Grant: *Hidden Potential*, *Think Again*
- Josef Pieper: *Leisure: The Basis of Culture*
- Pope Benedict XVI: *Introduction to Christianity*
- Dietrich von Hildebrand: *The Heart*
- Frank Sheed: *Theology for Beginners*
- Walker Percy: *Lost in the Cosmos*, *The Loss of the Creature*
- Donella Meadows: *Thinking in Systems* (2 versions)
- Jonathan Haidt: *The Righteous Mind*
- Daniel Kahneman: *Thinking Fast and Slow*
- Jim Collins & Jerry Porras: *Built to Last*
- Everett Rogers: *Diffusion of Innovations*
- Michael Gerber: *E-Myth Revisited*
- Barbara Minto: *The Minto Pyramid Principle*
- Barbara Oakley: *Uncommon Sense Teaching*
- Roland Allen: *The Notebook*
- Marty Neumeier: *The Brand Gap*
- David C. Baker: *The Business of Expertise*
- Julia Galef: *The Scout Mindset*
- Timothy Gallwey: *The Inner Game of Tennis*
- Steven Johnson: *Where Good Ideas Come From*
- John Crosby: *The Personalist Papers*
- PHM journal article on meditation

**Notion pages (`notion_` prefix)**
- ~100+ vectors — Notion database rows (projects, tasks) synced in
- Includes database ID, URL, tags; content is serialized row text

**Work logs / thoughts (`thought_` prefix)**
- Captured thoughts, work logs, design docs tagged with freeform tags
- ID format: `thought_{hash}`

**Guides / architecture docs (`guide_` prefix)**
- GravityClaw architecture guides, transcripts of tutorial videos
- ID format: `guide_{filename}_chunk_{n}`

**Briefs (various `_brief` suffix)**
- Business framework briefs (EOS/Ninety.io and custom): `agreements_brief`, `org_chart_brief`, `rocks_brief`, `issues_brief`, `process_brief`, etc.
- ID format: `{topic}_brief_chunk_{n}`

**Ninety.io guides (`on_` prefix)**
- EOS/Ninety.io methodology content
- ID format: `on_{topic}_guide_ninety_chunk_{n}`

**EM brand analysis (`em_brand_` prefix)**
- Competitive analysis, content gap matrix, brand extraction docs

**ZPM content gap (`zpm_` prefix)**
- Zealous Parish Ministers competitive/positioning analysis

**Other singles**
- `virtual_cv`, `synod_on_synodality_...`, `entrepreneur_revolution_...` (duplicate Priestley book IDs without `book_` prefix)

**Metadata fields — `knowledge` namespace:**

| Field | Type | Present on |
|---|---|---|
| `text` | string | All |
| `type` | string | All (`"knowledge"`, `"persona_memory"`) |
| `source` | string | Most (`"youtube"`, `"pdf"`, `"notion"`, `"architecture_guide"`) |
| `chunk_index` | int | Chunked docs |
| `total_chunks` | int | Chunked docs |
| `title` | string | YouTube, books, some guides |
| `url` | string | YouTube, Notion |
| `video_id` | string | YouTube only |
| `author` | string | Some books |
| `filename` | string | PDFs and guides |
| `folder` | string | PDFs (`"books"`) and guides (`"GUIDES"`) |
| `ingest_type` | string | PDFs (`"book"`) and guides (`"architecture_guide"`) |
| `tags` | string[] | Thoughts/work logs, Notion |
| `database_id` | string | Notion only |

---

### Namespace: `conversations`

- 211 vectors
- ID format: `msg_{unix_timestamp}`
- **Metadata fields:** `text` (conversation turn text), `timestamp` (float), `type` ("conversation")
- Short-term conversation turns stored as rolling memory; no video_id or source linkage

---

### Namespace: `content`

- 209 vectors
- Competitor intelligence: FOCUS and YDisciple website content scraped via Firecrawl
- ID format: UUID
- **Metadata fields:** `text`, `source` ("website"), `competitor` (org name), `competitor_id` (UUID), `content_type` ("blog_post"), `published_at` (string, often empty), `topic_tags` (string[])

---

### Namespace: `ceo-memory` / `developer-memory` / `content-memory` / `marketing-memory` / `cordis-memory`

- 2–10 vectors each
- Persona-specific short-term context windows
- ID format: `persona_{hash}`
- **Metadata fields:** `text` (conversation snippet), `timestamp` (float), `type` ("persona_memory"), `persona_id` (e.g. "ceo", "developer", "cordis"), `channel` ("context" or "attention"), `source_persona` (optional — for cross-agent messages)

---

## Flags

1. **Pinecone MCP plugin has no API key configured.** The `pinecone-claude-plugins-official` plugin data directory is empty. The key lives only in `/Users/edmundmitchell/gravityclaw/.env`. This needs to be entered in the plugin settings before any MCP-based Pinecone tools will work in new sessions.

2. **Duplicate Priestley book entries.** IDs like `entrepreneur_revolution_daniel_priestley_chunk_*` and `book_oceanofpdf_com_entrepreneur_revolution_daniel_priestley_chunk_*` appear to be the same book ingested twice under different ID schemes (~400+ duplicate chunks). Worth deduplicating on migration.

3. **Notion sync is not curated.** The `notion_` IDs include what appear to be sample/placeholder Notion rows (a "Taxes" project with boilerplate summary text about "50% reduction in page load times" — clearly template content). These likely came from a Notion workspace with sample data and should be audited before migration.

4. **`conversations` namespace naming is ambiguous.** The 211 vectors here are conversation memory turns (msg_ prefix, timestamp IDs), NOT the 211 Cordial Catholics video transcripts. The YouTube transcripts are in `knowledge` under `yt_` IDs. The naming could mislead.

5. **Agent memory namespaces are ephemeral by design but could drift.** `cordis-memory` has 10 vectors, others have 2–4. These are useful for persona continuity but contain no long-term durable knowledge — not worth migrating to pgvector if rebuilding.

6. **`content` namespace has no ingest date field.** The `published_at` field is present but empty on sampled records. No timestamp means it's impossible to know when the competitor scrape was run or how stale the data is.

7. **`knowledge` namespace has inconsistent metadata schemas across ingest types.** Books have `author`, `filename`, `folder`, `ingest_type`, `chunk_index`, `total_chunks`. YouTube has `video_id`, `url`, `title`, `chunk_index`. Thoughts have `tags`. Notion has `database_id`, `tags`, `url`. These schemas don't share a common `source_id` or `ingest_date` field — filter-based retrieval is brittle and will need normalization on migration.

8. **No `ingest_date` or `last_updated` field anywhere.** Cannot determine data freshness for any corpus type. Recommended field to add on rebuild.
