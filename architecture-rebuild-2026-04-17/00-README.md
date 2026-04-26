# Architecture Rebuild — 2026-04-17

Working notebook for rebuilding Edmund's personal/work AI stack around Claude-native + native MCP servers, retiring GravityClaw.

## How to use this folder

This is a **living notebook**, not a finalized PRD. Files evolve as decisions get made and research comes in. We chat → decisions + research get logged here → we revise together.

## Folder map (active)

| Folder | Purpose |
|---|---|
| `01-context/` | Who Edmund is, stack, principles. Stable once set. |
| `03-decisions/` | ADR-style log of firm decisions + list of open questions. |
| `05-design/` | Target architecture, migration SQL, currently-executing plans. |
| `06-handoffs/` | `autonomy-charter.md` (rules of engagement) + `backlog.md` (future work). |
| `archive/` | Frozen reference: baseline audit, research findings, old handoffs, old plans, autonomous-run logs. Look here for history, not active work. |

## Entry points

- **Just joining?** Read `01-context/` → `03-decisions/decisions-log.md` → `05-design/target-architecture.md`.
- **Making a decision?** Add to `03-decisions/decisions-log.md` with date + rationale.
- **Need to look up past research or a previous run?** Check `archive/04-audit/` or `archive/autonomous-runs/`.
- **Starting a new work plan?** Add a dated file to `05-design/plans/`. When it's done, move it to `05-design/plans/done/`.

## 2026-04-24 cleanup

This folder got pruned from 153 files to 44 at the top level. Everything historical (baseline audit, research findings, old handoffs, completed/superseded plans, autonomous-run logs) lives under `archive/`. Nothing deleted — just moved so the active working surface is legible. See `CEO Cowork/00-SYSTEM-INDEX.md` Changelog for why.

## Source of handoff

Original context for this rebuild: CEO Desk handoff dated 2026-04-17. Preserved verbatim in `05-design/target-architecture.md` as the starting point.
