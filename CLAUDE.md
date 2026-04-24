# Factory — Project Instructions

This is Edmund's top-level working directory. It contains the in-progress rebuild of his personal/work AI stack, plus research and reference material.

## Where things live

| Path | What |
|---|---|
| `architecture-rebuild-2026-04-17/` | **Current focus.** Living notebook for the rebuild. Start here. |
| `dashboard/` | Sister repo ([bummerlazarus/local-agents-dashboard](https://github.com/bummerlazarus/local-agents-dashboard)) cloned into `./dashboard/` and gitignored here. Supabase migration in progress at `dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md`. |
| `research/` | External reference material and cloned repos (read-only). `tool-guides/` has 20+ overview docs; `reference-repos/OB1-main/` for OB-1 patterns. |
| `gravityclaw/` | (external: `/Users/edmundmitchell/gravityclaw/`) Legacy custom MCP server, slated for retirement. Read-only. |

## Current focus: the rebuild

Read `architecture-rebuild-2026-04-17/00-README.md` first. That folder is a living notebook — we add to it as decisions get made.

The rebuild retires GravityClaw (custom Railway MCP) and moves to:
- Claude-native features (scheduled tasks, Skills, Projects)
- Native MCPs (Supabase, Pinecone, Notion, Firecrawl, Vercel)
- Supabase Edge Functions for unique business logic

Wave 10 compression engine shipped 2026-04-19 (commit `a519da3` on `feat/compression-engine`). Architecture spec: `dashboard/docs/compression-engine.md`.

**Guiding principle:** Edmund will not outbuild Anthropic. See `architecture-rebuild-2026-04-17/01-context/principles.md`.

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

## Working style

- Markdown-first. Edmund reviews files in the sidebar while we chat.
- Conversation → decisions/research logged to files → reviewed together.
- Don't over-engineer. Minimum complexity for the current task.
- Read files before modifying; never guess at business logic.
- If MCP tools fail twice, stop and ask.
- Never use `browser_subagent` — crashes the system.
- Firecrawl is the primary web research tool.
- Autonomous-run rules of engagement live in `architecture-rebuild-2026-04-17/06-handoffs/autonomy-charter.md`.

## When Edmund dispatches a research run

Save the report to `architecture-rebuild-2026-04-17/04-audit/YYYY-MM-DD-<topic>.md` and summarize back.

## When a firm decision gets made

Add an entry to `architecture-rebuild-2026-04-17/03-decisions/decisions-log.md` (dated, with rationale).

## When open questions resolve

Move them from `03-decisions/open-questions.md` into the decisions log.
