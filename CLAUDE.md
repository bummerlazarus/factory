# Factory — Project Instructions

This is Edmund's top-level working directory. It contains the in-progress rebuild of his personal/work AI stack, plus research and reference material.

## Supabase project IDs (do NOT guess these)

Every Supabase MCP call requires a `project_id`. There is no default. If you skip `list_projects` and invent a plausible-looking ref, Supabase returns a generic `MCP error -32600: You do not have permission to perform this action`, which looks like an auth bug but is actually a wrong-project error.

| Project | `project_id` (ref) | Status |
|---|---|---|
| **em-edmund-mitchell** (skills registry, memory, ingest_runs — use this by default) | `obizmgugsqirmnjpirnh` | ACTIVE_HEALTHY |
| IOC system | `gbckletkgxjconwxumcr` | INACTIVE (paused — call `restore_project` before querying) |

Anything else is wrong. Verify with `list_projects` if unsure.

> **Read this first: `~/Documents/Claude/Projects/CEO Cowork/00-SYSTEM-INDEX.md`.** That doc is the operating map for Edmund's whole stack — where memory lives, where skills live, where outputs go, what fires when. Anything structural that changes in factory/ should be reflected in its Changelog. If you're unsure where something belongs, check the index before guessing.

## Where things live

| Path | What |
|---|---|
| `dashboard/` | Sister repo ([bummerlazarus/local-agents-dashboard](https://github.com/bummerlazarus/local-agents-dashboard)) cloned into `./dashboard/` and gitignored here. Deployed to Vercel as project `dashboard` (prod URL `dashboard-nine-delta-26.vercel.app`). |
| `ops/bin/` | Ingest scripts. Every script writes to Supabase `public.ingest_runs` (migration 017) so failures are debuggable. |
| `ops/docs/` | Operational references: `capture-api.md`, `iphone-shortcuts-guide.md`, `specialist-spawn.md`, **`agent-source-of-truth.md`** (READ THIS before editing any agent — disk vs. DB convention), **`loose-ends.md`** (READ THIS before ending a session — write follow-ups to `agent_tasks`, don't ask Edmund to remember them). |
| `ops/autonomy-charter.md` | Rules of engagement for autonomous runs. |
| `ops/north-star.md` | Vision anchor — what "done" feels like for the stack. |
| `supabase/migrations/` | Numbered SQL migrations. Latest: `037_model_calls.sql` (2026-05-03). |
| `supabase/proposals/` | Live design proposals not yet executed (e.g. `table-registry.md`, `pii-default-deny-rls.md`). |
| `skills/` | Working subset of SKILL.md files. **Not** the source of truth — see Skills section below. |
| `reference/` | External reference material and cloned repos (read-only). Contains `tool-guides/` (20+ overview docs), `reference-repos/` (e.g. `OB1-main/` for OB-1 patterns), `guides/`, `archive/`. **Clone new reference repos here**, not into a `research/` folder (that path doesn't exist). |
| `archive/architecture-rebuild-2026-04-17/` | **RETIRED 2026-05-02.** Frozen rebuild notebook. Read `RETIREMENT.md` for what shipped and where artifacts moved. Do not read for current state. |

## Stack shape (post-rebuild)

The rebuild ran 2026-04-17 → 2026-04-26 and retired GravityClaw. Current architecture:
- Claude-native features (scheduled tasks, Skills, Projects)
- Native MCPs (Supabase, Notion, Firecrawl, Vercel)
- Supabase Edge Functions for unique business logic
- Single-table pgvector store at `public.memory` (replaced Pinecone)

**Guiding principle:** Edmund will not outbuild Anthropic. See `ops/north-star.md`.

## Where agent-produced artifacts land

Three independent stores. `public.artifact_links` (migration 036, 2026-05-03) cross-links them so the dashboard surfaces stay discoverable:

| Storage | What lives there | Surface |
|---|---|---|
| `COWORK_PATH` (disk) | `write_file` outputs, agent personalities | `/files` |
| `public.workspace_items` | Plans / Projects / Tasks / Scopes | `/workspace` |
| `public.reference_docs` | Sophia research briefs, Augustin syntheses, etc. | `/research` |

When `executeTool` is called with `activeWorkspaceItemId`, `sophia_research`, `augustin_synthesize`, and `write_file` automatically insert a row into `artifact_links` so the resulting brief/file shows up on `/workspace` (project detail → Artifacts) and a "Linked to" badge appears on `/research/[id]`.

## Skills registry lives in THREE places

Before saying "no skill exists for X" or creating a new skill, check all three:

1. **`~/.claude/skills/<name>/SKILL.md`** — local, auto-discovered by Claude Code.
2. **Supabase `public.skill_versions` table** — networked source of truth. Query: `SELECT skill_name, version, status FROM skill_versions WHERE skill_name ILIKE '%<kw>%' OR body ILIKE '%<kw>%';`
3. **Notion "Systems, SOPs & Skills Index"** (page `313bfe74-5aa2-81f3-8ef7-e506065faf11`) — master human-facing map. Feature specs live in the adjacent **SOPs database** (`31abfe74-5aa2-805a-9806-c6e3426ccbed`).

When creating a new skill, write to all three. See `reference_skills_registry.md` in project memory.

## Ingest scripts — use them, don't pipe transcripts through context

For ingesting large bodies (transcripts, articles, PDFs) into Supabase, use the shell scripts in `ops/bin/` that `curl` the Edge Function directly. **Never pass a transcript as an MCP tool string argument** — it flows through Claude's context twice and burns ~10k tokens per 30KB.

| Script | Use for |
|---|---|
| `ops/bin/ingest-youtube.sh <url> [--force] [--tags a,b]` | YouTube ingests (any length) |

The `youtube-ingest-mcp` MCP tool exists but is only safe for tiny clips. Full-length videos must go through the script. Same pattern applies to future ingest paths.

**Every ingest script writes to `public.ingest_runs`.** Run ID is printed to stdout. To inspect the last 20 runs:
```sql
SELECT started_at, status, source_title, items_processed, error_message
FROM public.ingest_runs ORDER BY started_at DESC LIMIT 20;
```
Any new ingest pipeline (article, PDF, transcript) MUST follow this pattern — insert at start, update at end with status/counts/error.

## Working style

- Markdown-first. Edmund reviews files in the sidebar while we chat.
- Conversation → decisions/research logged to files → reviewed together.
- Don't over-engineer. Minimum complexity for the current task.
- Read files before modifying; never guess at business logic.
- **Before editing ANY file under `agent personalities/agents/<id>/` (identity / soul / CLAUDE.md), read [`ops/docs/agent-source-of-truth.md`](ops/docs/agent-source-of-truth.md) and confirm `COWORK_PATH` in `dashboard/.env.local`. Wrong copy = dashboard keeps serving old prompts. Bit twice on 2026-05-03.** This rule retires when the v2 plan (`ops/plans/2026-05-03-agent-personas-and-memory.md`) ships and DB becomes source of truth.
- If MCP tools fail twice, stop and ask.
- Never use `browser_subagent` — crashes the system.
- Firecrawl is the primary web research tool.
- Autonomous-run rules of engagement live in `ops/autonomy-charter.md`.

## When Edmund dispatches a research run

Save the report under `ops/research/YYYY-MM-DD-<topic>.md` (create the dir if missing). The old `architecture-rebuild-2026-04-17/04-audit/` path is retired.

## When a firm decision gets made

Append to `archive/architecture-rebuild-2026-04-17/03-decisions/decisions-log.md` (dated, with rationale). The decisions log was kept after the rebuild was retired because it's the canonical history; new entries still go on top.

## When open questions resolve

Move them from `archive/architecture-rebuild-2026-04-17/03-decisions/open-questions.md` into the decisions log.
