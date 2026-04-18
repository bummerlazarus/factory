# Factory — Project Instructions

This is Edmund's top-level working directory. It contains the in-progress rebuild of his personal/work AI stack, plus research and reference material.

## Where things live

| Path | What |
|---|---|
| `architecture rebuild 2026-04-17/` | **Current focus.** Living notebook for the rebuild. Start here. |
| `dashboard/` | Production dashboard app (Next.js). Formerly `local agent dashboard/`. Supabase migration in progress at `dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md`. |
| `production/` | Production-related artifacts. |
| `research/` | External reference material and cloned repos (read-only). `tool-guides/` has 20+ overview docs; `reference-repos/OB1-main/` for OB-1 patterns. |
| `gravityclaw/` | (external: `/Users/edmundmitchell/gravityclaw/`) Legacy custom MCP server, slated for retirement. Read-only. |

## Current focus: the rebuild

Read `architecture rebuild 2026-04-17/00-README.md` first. That folder is a living notebook — we add to it as decisions get made.

The rebuild retires GravityClaw (custom Railway MCP) and moves to:
- Claude-native features (scheduled tasks, Skills, Projects)
- Native MCPs (Supabase, Pinecone, Notion, Firecrawl, Vercel)
- Supabase Edge Functions for unique business logic

**Guiding principle:** Edmund will not outbuild Anthropic. See `architecture rebuild 2026-04-17/01-context/principles.md`.

## Working style

- Markdown-first. Edmund reviews files in the sidebar while we chat.
- Conversation → decisions/research logged to files → reviewed together.
- Don't over-engineer. Minimum complexity for the current task.
- Read files before modifying; never guess at business logic.
- If MCP tools fail twice, stop and ask.
- Never use `browser_subagent` — crashes the system.
- Firecrawl is the primary web research tool.

## When Edmund dispatches a research run

Save the report to `architecture rebuild 2026-04-17/04-audit/YYYY-MM-DD-<topic>.md` and summarize back.

## When a firm decision gets made

Add an entry to `architecture rebuild 2026-04-17/03-decisions/decisions-log.md` (dated, with rationale).

## When open questions resolve

Move them from `03-decisions/open-questions.md` into the decisions log.
