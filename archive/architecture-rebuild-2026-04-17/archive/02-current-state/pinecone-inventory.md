# Pinecone Inventory

**Status:** Audited 2026-04-17. Full raw audit at `04-research/2026-04-17-pinecone-audit.md`.

## Index: `gravity-claw`

- **Total vectors:** 14,491
- **Dimensions:** 3072 (bring-your-own — OpenAI `text-embedding-3-large`)
- **Metric:** cosine
- **Hosting:** Serverless, AWS us-east-1
- **Integrated embedding:** No — all embeddings generated externally before upsert
- **`fieldMap`:** text field is named `text` on all records

## Namespaces

| Namespace | Vectors | Purpose |
|---|---|---|
| `knowledge` | 14,050 | Primary corpus (books, YT transcripts, Notion, work logs, guides, briefs) |
| `conversations` | 211 | Rolling conversation memory turns (NOT video transcripts) |
| `content` | 209 | Competitor intelligence — FOCUS, YDisciple scraped content |
| `cordis-memory` | 10 | Cordis persona contextual memory |
| `ceo-memory` | 4 | CEO persona contextual memory |
| `developer-memory` | 3 | Developer persona contextual memory |
| `content-memory` | 2 | Content persona contextual memory |
| `marketing-memory` | 2 | Marketing persona contextual memory |

## `knowledge` corpus breakdown (by ID prefix)

| Prefix | Content |
|---|---|
| `yt_` | ~200+ Cordial Catholics / ZPM video chunks |
| `book_` | 25+ books (Hormozi, Priestley, Storr, Pieper, Hildebrand, Grant, Haidt, etc.) |
| `notion_` | ~100 Notion database rows (projects, tasks) |
| `thought_` | Captured thoughts, work logs |
| `guide_` | GravityClaw architecture guides |
| `*_brief` | EOS/Ninety.io briefs (org chart, rocks, issues, process, etc.) |
| `on_` | EOS/Ninety.io methodology content |
| `em_brand_` | EM brand analysis, competitive docs |
| `zpm_` | ZPM competitive/positioning analysis |

## `knowledge` metadata schema

| Field | Type | Present on |
|---|---|---|
| `text` | string | All |
| `type` | string | All (`"knowledge"` or `"persona_memory"`) |
| `source` | string | Most (`"youtube"`, `"pdf"`, `"notion"`, `"architecture_guide"`) |
| `chunk_index` | int | Chunked docs |
| `total_chunks` | int | Chunked docs |
| `title` | string | YouTube, books, some guides |
| `url` | string | YouTube, Notion |
| `video_id` | string | YouTube only |
| `author` | string | Some books |
| `filename` | string | PDFs and guides |
| `folder` | string | PDFs (`"books"`), guides (`"GUIDES"`) |
| `ingest_type` | string | PDFs (`"book"`), guides (`"architecture_guide"`) |
| `tags` | string[] | Thoughts/work logs, Notion |
| `database_id` | string | Notion only |

**No `ingest_date` or `last_updated` field exists anywhere in the index.**

## Hybrid / filter patterns in use

Metadata filters are used by source type (`source = "youtube"`, `source = "pdf"`, etc.) and by persona (`persona_id = "ceo"`). No complex multi-field filters observed. Hybrid retrieval is coarse — filter on source type, then vector similarity. This is straightforward to replicate in pgvector.

## Flags for migration

1. **Pinecone MCP plugin has no API key configured.** Key lives only in `gravityclaw/.env` — must be entered in plugin settings for MCP tools to work.
2. **Duplicate Priestley book entries.** `entrepreneur_revolution_*` and `book_oceanofpdf_com_entrepreneur_revolution_*` are the same book ingested twice (~400+ duplicate chunks). Deduplicate on migration.
3. **Notion sync has stale/placeholder rows.** Some `notion_` vectors contain template sample content (e.g. "50% reduction in page load times" under a "Taxes" project). Audit before migrating.
4. **`conversations` namespace naming is ambiguous.** These are conversation memory turns, not video transcripts. Video transcripts are `yt_*` in `knowledge`.
5. **`content` namespace has no ingest date.** `published_at` is empty on all sampled records — impossible to know data freshness.
6. **Inconsistent metadata schemas.** No shared `source_id` or `ingest_date` across ingest types — filter-based retrieval will be brittle. Normalization needed on rebuild.

## Consolidation question (Q2)

Current hybrid filtering is simple (single-field filters). pgvector at 14K vectors is trivially sufficient. **Leaning: keep Pinecone for now** — corpus already lives there and ingestion works. Architect query layer as a single swappable module. Revisit in 3–6 months. → See `03-decisions/open-questions.md` Q2.
