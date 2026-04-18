# Notion Audit — 2026-04-17

## Summary

- **Total active databases identified:** 6 core + 2 deprecated
- **Role:** Notion is a **surface and source of truth** — not a view over Supabase. All core ops data (tasks, content pipeline, sessions, SOPs, meetings, pitches) lives here with no Supabase equivalent.
- **Agent access:** Notion MCP (hosted, OAuth) is already connected. No GravityClaw wrapper needed.
- **Deprecated state:** Two old databases (Projects, Tasks) are explicitly deprecated and redirected to the unified Work DB.

---

## Active Databases

### 1. 🧭 Work DB
- **URL:** https://www.notion.so/f7f9cadfb1c1444f9d5cc1212d0fa83f
- **Data source ID:** `fb05de23-cb14-4d2b-93c1-213a83201bd6`
- **Purpose:** Unified project + task manager. Agent-first — Claude manages all entries. Edmund does not interact manually.
- **Mental model:** No Type field. Hierarchy determines type: item with sub-items = project, leaf item = task.

**Schema:**

| Field | Type | Values / Notes |
|---|---|---|
| Name | Title | Verb-first for tasks, noun-phrase for projects |
| Status | Select | Inbox / To Do / In Progress / Waiting / Done (tasks) |
| Health | Select | Green / Yellow / Red / Not Started / Archived (projects) |
| Brand | Multi-select | EM / ZPM / R+T / FAI / CP / CFCS / Liv / Admin |
| Priority | Select | High / Medium / Low |
| Due Date | Date | Only set when a real deadline exists |
| Notes | Text | Context, dependencies, links |
| Assignee | Person | Blank = Edmund. Named = delegated. |
| Parent item | Self-relation | Links tasks to parent project |
| Sub-items | Self-relation | Auto-populated from Parent item |

**Key SOPs:**
- Auto-create without asking: when Edmund commits to a task/deliverable
- Auto-update without asking: status changes from conversation ("I did X", "I'm working on X")
- Ask first before: Archiving, deleting, restructuring

**Known standing deadlines (as of 2026-04-17):**
- CFCS Visual Identity Refresh: 2026-05-01
- CFCS Internal Narrative Training Kit: 2026-06-01
- Liv Napa Podcast Recording: 2026-07-20

**Rebuild role:** Keep as primary task/project surface. Claude should use Notion MCP `notion-create-pages` and `notion-update-page` for all writes. Notion MCP `notion-query-database-view` for reads.

---

### 2. 👨🏽‍💻 Creator Engine
- **URL:** https://www.notion.so/97b70c80900d4a7f9c1f09c953a88b41
- **Data source ID:** `855cedd6-f043-40d6-86c3-3d9de55f4501`
- **Purpose:** Content pipeline — idea capture through publish. Covers all brands and all content types.

**Schema (key fields):**

| Field | Type | Values |
|---|---|---|
| Name | Title | Content title/idea |
| Type | Multi-select | Idea / Daily / IP-Framework / Social Post / YouTube Video / Newsletter / Article / Carousel / Reel / Lead Magnet / Product / Swipe File / Resource-Reference / AI resource |
| status | Multi-select | Idea / Outlining / Drafting / Editing / Scheduled-Published |
| Status | Status | Not started / In progress / Done |
| Brand | Multi-select | ZPM / EM / R+T / FAI / Liv |
| Platform | Multi-select | Instagram / YouTube / Beehiiv / Website / LinkedIn / TikTok |
| Format | Multi-select | Short-form video / Long-form video / Written / Audio / PDF / Template / Course-Kit / Product / Offer |
| Priority | Select | High / Medium / Low |
| Impact | Select | Low / Medium / High |
| Effort | Select | Low / Medium / High |
| Readiness Score | Formula | Auto-calculated (max 14). Sort descending to surface best ideas. |
| Arc Phase | Select | Tease / Document / Showcase |
| Idea Type | Select | Hook / Device / Gag / Set Piece / Opponent Beat / CTA / Meme / Question / UGC prompt / Creative direction |
| Channel Fit | Multi-select | YouTube / TikTok / Instagram / LinkedIn / Email / Website |
| Publish Date | Date | |
| Date Captured | Date | |
| Revenue Type | Select | Free / Paid / Lead Magnet |
| Resource Ready | Checkbox | |
| Product Live | Checkbox | |
| ⭐️ | Select | 1–5 stars (quality signal) |
| Series | Text | Series name |
| Media Type | Multi-select | B-roll / Audio / Zoom / Photos / Written notes / Screenshot |
| Visual Tools | Multi-select | Screen Recording / Claude Diagram / Claude HTML / Excalidraw / etc. |
| File Location | Text | |
| URL | URL | |
| Notes | Text | |
| Price | Number ($) | For paid products |

**Views:**
- Default view (all items, sorted by Date Captured desc)
- Table (filtered: active pipeline — Drafting, Idea, Editing, Scheduled/Published)
- Production Readiness (board, grouped by Series, sorted by Readiness Score, Idea status only)
- EM Brand (filtered view)

**Rebuild role:** Notion is source of truth. No Supabase equivalent. Claude should write to this via Notion MCP when capturing ideas from conversation. The Readiness Score formula is valuable — don't replicate in Supabase.

---

### 3. CEO Desk Sessions
- **URL:** https://www.notion.so/23f5fc506c6442d8b0734b21cfc75108
- **Data source ID:** `560c8bee-c4ab-46b2-902f-4ae5089c91ab`
- **Purpose:** Log of CEO Desk sessions — what was covered, deliverables created, open items.

**Schema:**

| Field | Type | Values |
|---|---|---|
| Session | Title | Session name/date |
| Date | Date | |
| Focus Areas | Multi-select | EM / ZPM / R+T / FAI / CFCS / CP / Liv / DC / Systems |
| Status | Select | Open / Closed / Follow-up needed |
| Deliverables Created | Number | |
| Open Items | Number | |
| Chat URL | URL | Link to Claude conversation |

**Rebuild role:** Keep as session log. Claude should close each session by logging to this DB via Notion MCP. The Chat URL field is a useful reference pattern — carry forward.

---

### 4. SOPs
- **URL:** https://www.notion.so/31abfe745aa2805a9806c6e3426ccbed
- **Data source ID:** `31abfe74-5aa2-80cd-9807-000b2494f104`
- **Purpose:** Standard operating procedures for all ventures and systems.
- **Known properties:** Area (e.g. "CEO Ops"), Status (Published), Type (SOP), Name, Notes, Reference Link, Last updated.
- **Rebuild role:** Notion is source of truth. SOPs are written here and referenced by Claude Projects system prompts. No agent writes to SOPs except when creating a new SOP from a session.

---

### 5. Meetings
- **URL:** https://www.notion.so/7c5477f0d4b94422bd94506eae0e0396
- **Purpose:** Meeting notes database.
- **Rebuild role:** Notion is source of truth. Meeting notes logged here after sessions.

---

### 6. Media Outlet Pitches
- **URL:** https://www.notion.so/ad48b10c55814ad186345e31de9818a1
- **Purpose:** Tracks media pitches (articles, appearances) to external outlets.
- **Rebuild role:** Niche but active — used for Cordial Catholic article pitches to Church Life Journal, etc.

---

## Deprecated Databases

| Database | ID | Redirect |
|---|---|---|
| [DEPRECATED] Projects | `98bd9c43-d57d-4a9e-aa7d-33ebc11257b5` | → Work DB |
| [DEPRECATED] Tasks | `b0baf413-ef03-4bfc-a4e7-3fc9028c268c` | → Work DB |

Do not create new entries. Old data remains but is not actively maintained.

---

## GravityClaw Hardcoded DB Map (preserve before deleting `get_notion_tasks`)

The `get_notion_tasks` tool had a hardcoded map of 6 database names → IDs. Mapping to confirmed current IDs:

| GravityClaw name | Confirmed current DB | Current ID |
|---|---|---|
| `tasks` / `projects` | Work DB (unified) | `fb05de23-cb14-4d2b-93c1-213a83201bd6` |
| `content` / `ideas` | Creator Engine | `855cedd6-f043-40d6-86c3-3d9de55f4501` |
| `sops` | SOPs | `31abfe74-5aa2-80cd-9807-000b2494f104` |
| `sprints` | Unknown — likely deprecated or folded into Work DB | — |

The `sprints` database name had no match found. Likely folded into Work DB or abandoned.

---

## Key Observations for Rebuild

1. **Notion is not a view — it's the data.** Work tasks, content pipeline, session logs, SOPs, and meetings have no Supabase mirror. They originate in Notion. This means Notion MCP is non-optional in the new stack.

2. **Work DB is fully agent-managed.** Claude is the only writer. This is the correct model — maintain it. Edmund's explicit instruction in the SOP: he does not interact with it manually.

3. **Creator Engine has a Readiness Score formula.** This is computed entirely in Notion and surfaces the highest-priority ideas automatically. Don't replicate this in Supabase — let Notion own it.

4. **Two Notion databases are cleanly deprecated.** [DEPRECATED] Projects and Tasks have explicit redirects. The migration to Work DB already happened.

5. **No signals or agent memory in Notion.** Signals live in Supabase. Agent memory lives in Pinecone + Supabase. Notion is purely a human-readable ops surface.

6. **Session closeout pattern.** CEO Desk Sessions DB captures Claude Chat URL + deliverables created + open items. This is a valuable accountability loop — should be preserved and extended to Factory/Code sessions.

7. **Notion MCP is already wired.** Zero migration effort for read/write. Native MCP replaces `get_notion_tasks`, `read_notion_database`, `write_notion_page` immediately.
