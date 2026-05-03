# Notion Inventory

**Status:** Audited 2026-04-17. Full audit at `04-audit/2026-04-17-notion-audit.md`.

## Role

Notion is **source of truth**, not a view over Supabase. All core ops data originates here — no Supabase mirror exists for any of these databases.

## Active Databases

| Database | Data Source ID | Purpose | Rebuild role |
|---|---|---|---|
| 🧭 Work | `fb05de23-cb14-4d2b-93c1-213a83201bd6` | Unified project + task manager (agent-managed) | Keep — primary surface |
| 👨🏽‍💻 Creator Engine | `855cedd6-f043-40d6-86c3-3d9de55f4501` | Content pipeline: idea → publish | Keep — Notion owns it |
| CEO Desk Sessions | `560c8bee-c4ab-46b2-902f-4ae5089c91ab` | Session log with deliverables + open items | Keep — extend to Factory sessions |
| SOPs | `31abfe74-5aa2-80cd-9807-000b2494f104` | Standard operating procedures | Keep — read-only for agents |
| Meetings | `7c5477f0-d4b9-4422-bd94-506eae0e0396` | Meeting notes | Keep |
| Media Outlet Pitches | `ad48b10c-5581-4ad1-8634-5e31de9818a1` | Article + media pitch tracker | Keep |
| Swipe Files | `0309e828-4eb8-46ed-ae71-0278ee307648` | External design/format inspiration (URLs, screenshots) | Keep — distinct from Creator Engine |
| Podcast Outreach Tracker | `e4ebaa24-aa20-477c-9aee-b56c375ec076` | Guest bookings, pitches, recordings | Keep |
| People | `c3235345-5dc6-4668-9161-f7c1b5dbdc41` | Contact/relationship database | Keep — read-only for agents |
| Organizations | `b973fec1-238d-4dfe-9810-82801baca686` | Orgs/clients reference | Keep — read-only for agents |
| Strategies | `31bbfe74-5aa2-808a-82f8-d6c832d12e65` | Strategy docs | Keep — read-only for agents |

## Deprecated Databases

| Database | Old ID | Status |
|---|---|---|
| [DEPRECATED] Projects | `98bd9c43-d57d-4a9e-aa7d-33ebc11257b5` | Replaced by Work DB — do not write |
| [DEPRECATED] Tasks | `b0baf413-ef03-4bfc-a4e7-3fc9028c268c` | Replaced by Work DB — do not write |

## GravityClaw tool replacement

All three GravityClaw Notion tools (`get_notion_tasks`, `read_notion_database`, `write_notion_page`) are replaced by Notion MCP directly. Zero migration effort — MCP is already connected via OAuth.

The hardcoded DB name map from `get_notion_tasks`:
- `tasks` / `projects` → Work DB (`fb05de23...`)
- `content` / `ideas` → Creator Engine (`855cedd6...`)
- `sops` → SOPs DB (`31abfe74...`)
- `sprints` → likely deprecated / folded into Work DB

## Key facts for future sessions

- **Work DB is fully agent-managed.** Edmund does not write to it manually. Claude creates/updates entries from conversation context.
- **Creator Engine has a Readiness Score formula** (max 14, auto-calculated in Notion). Do not replicate in Supabase.
- **No signals or agent memory in Notion.** Signals → Supabase. Agent memory → Pinecone + Supabase. Notion = ops surface only.
- **Session closeout pattern:** CEO Desk Sessions captures Chat URL + deliverables + open items per session. Should extend to all Claude Code / Factory sessions.
