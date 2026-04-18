# Architecture Rebuild — 2026-04-17

Working notebook for rebuilding Edmund's personal/work AI stack around Claude-native + native MCP servers, retiring GravityClaw.

## How to use this folder

This is a **living notebook**, not a finalized PRD. Files evolve as decisions get made and research comes in. We chat → decisions + research get logged here → we revise together.

## Folder map

| Folder | Purpose |
|---|---|
| `01-context/` | Who Edmund is, stack, principles. Stable once set. |
| `02-current-state/` | Audit of what exists today (Supabase, Pinecone, GravityClaw, Notion). Filled by research runs. |
| `03-decisions/` | ADR-style log of firm decisions + list of open questions. |
| `04-audit/` | Audit findings and investigation reports (one file per topic, dated). |
| `05-design/` | Target architecture, migration plan, data model. The emerging build. |
| `06-handoffs/` | Ready-to-paste prompts for fresh Claude sessions. |

## Entry points

- **Just joining?** Read `01-context/` → `03-decisions/open-questions.md` → `05-design/target-architecture.md`.
- **Making a decision?** Add to `03-decisions/decisions-log.md` with date + rationale.
- **Starting a research run?** New file in `04-audit/` named `YYYY-MM-DD-<topic>.md`.

## Source of handoff

Original context for this rebuild: CEO Desk handoff dated 2026-04-17. Preserved verbatim in `05-design/target-architecture.md` as the starting point.
