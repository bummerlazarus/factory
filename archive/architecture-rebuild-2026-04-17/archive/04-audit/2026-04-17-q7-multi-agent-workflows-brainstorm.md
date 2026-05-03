# Q7 — Multi-Agent Workflow Shape (Brainstorm)

**Status:** Brainstorm, 2026-04-17. Not a decision. Pairs with `01-context/vision-and-priorities.md` pillars 3/4/5 and the Phase 1.5 schema (`sessions`, `work_log`, `observations`, `skill_versions`, `reference_docs`).

---

## 1. TL;DR

A small troupe of named Claude sub-agents, each with a narrow remit, all writing to the same shared brain (Supabase) and all governed by one approval surface. **Working agents** do the actual capture/content/triage work inside sessions. **Observer agents** watch what working agents produce and drop low-confidence notes into `observations`. **Curator agents** read clusters of observations on a cadence and propose `skill_versions` diffs. **Surfacing Skills** pull from `work_log` + `sessions` + `skill_versions` to give Edmund the "alive" feeling — daily recap, last-touched, goal progress. Approval happens in **one place: the dashboard `/inbox` (Promotions tab)**, with a Notion mirror for mobile. If Edmund ignores approvals, they expire with grace rather than piling up as guilt.

---

## 2. The Agents

Six agents. Four do work, two do meta-work. Names pulled from the existing Cordis/Axel/Corva/Hild/Lev cast where they fit; renamed where a new remit is cleaner.

### 2.1 Cordis — Companion / Capture (working)
- **Role:** Primary chat partner in the CEO Desk project and the dashboard chat. Takes captures, answers questions, triages "sort later."
- **Runs in:** every `session` of type `capture` or `chat`.
- **Writes:**
  - `sessions` row at start/end (scope = `ceo_desk` | `dashboard_chat`).
  - `work_log` entries for each discrete artifact handled ("triaged 4 inbox items to Creator Engine", "converted voice memo to transcript").
  - `observations` when it notices something worth promoting (low-confidence nudges).
- **Cadence:** per-session.

### 2.2 Axel — Content Engine (working)
- **Role:** Cordial Catholics + EM Cordial Creator Framework content pipeline. Idea → research → outline → script → repurpose (the IOC flow).
- **Runs in:** sessions of type `content` (explicit: user opens "Axel" in dashboard or tags a chat with `#content`).
- **Writes:**
  - `sessions` + `work_log` for each stage advanced.
  - `reference_docs` updates when a new framework / swipe example is filed.
  - `observations` when a capture looks like a content idea across multiple channels.
- **Cadence:** per-session, plus a weekly "content inventory" run.

### 2.3 Hild — Ops / Client Work (working)
- **Role:** Digital Continent client projects (CFCS, Liv Harrison, Culture Project) + ZPM + Real+True ops. Reads Asana + Notion Work DB. Tracks deliverables.
- **Runs in:** sessions of type `client` or `ops`.
- **Writes:**
  - `work_log` with `project` tag (one of the six ventures).
  - `observations` like "CFCS has had no work_log entries in 9 days."
- **Cadence:** per-session, plus a daily "last-touched-per-project" sweep.

### 2.4 Lev — Ingest / Librarian (working)
- **Role:** Runs the transcription + ingest path for voice memos, YouTube videos, PDFs, Riverside recordings. Tags, enriches, routes. The "Triage Inbox" Skill runs as Lev.
- **Runs in:** background via the `capture()` Edge Function trigger; on-demand from dashboard button.
- **Writes:**
  - New `reference_docs` rows for durable artifacts (playbooks extracted from a YouTube transcript, e.g. Faith & AI Project sources).
  - `work_log` entries ("ingested 3 voice memos totaling 48 min").
  - `observations` when an ingested artifact overlaps with an existing Skill's topic ("this transcript fits `skills/voice-tone`").
- **Cadence:** triggered by capture; daily sweep over untriaged inbox.

### 2.5 Corva — Observer / Retro (meta)
- **Role:** End-of-session retro Skill. Reads the conversation just finished, scans `work_log` + `observations` added during the session, and drafts **promotion proposals** against specific Skills or reference docs.
- **Runs in:** fires at session end for every working-agent session above a length threshold (e.g. >5 tool calls or >10 messages). Also on-demand ("Corva, run the retro").
- **Writes:**
  - `observations` rows (the retro notes).
  - `skill_versions` **drafts** (status = `proposed`, not `approved`) — concrete diffs against `skills/<topic>/SKILL.md` or `reference_docs`.
- **Cadence:** per-session at close.

### 2.6 The Librarian (meta, Skill not agent)
- **Role:** Daily cron-style Skill (Claude scheduled task). Reads the last 3–7 days of `observations`, deduplicates, clusters by target Skill/doc, and promotes the *cluster* into a single consolidated `skill_versions` proposal. Prevents observation sprawl.
- **Runs in:** no session. Scheduled task. Writes as a system actor.
- **Writes:**
  - Collapses many `observations` into one `skill_versions` proposal with `source_observation_ids = [...]`.
  - Marks superseded observations as `rolled_up`.
- **Cadence:** daily at 6am local.

**Why six and not twelve:** every additional named agent is a UI tile Edmund has to route to. Keeping it to one-per-domain (Cordis/Axel/Hild/Lev) plus two meta-agents (Corva/Librarian) maps cleanly to Edmund's mental model without fragmenting context.

---

## 3. Observation → Promotion Loop

The happy path. Concrete example: Edmund in CEO Desk explains a new hook formula he used on a Cordial Catholics short that worked.

1. **Capture.** Cordis writes the conversation to `sessions` + `work_log` (`type=insight_shared`, project=`cordial_catholics`).
2. **Observation.** Cordis notices this touches `skills/voice-tone` and `skills/content-planning`. Drops two `observations` rows: `{target_skill: voice-tone, note: "hook formula X works for short-form", confidence: 0.6}`.
3. **Session close → Corva.** End-of-session retro fires. Corva reviews the session's `work_log` + `observations`. Turns them into a concrete **draft `skill_versions` row** — an actual markdown diff against `skills/voice-tone/SKILL.md` adding the hook formula under "Examples." Status = `proposed`. Also asks in chat: *"I drafted one Skill update and one reference-doc update — review now or later?"*
4. **Promotion UI.** Proposal appears in the dashboard `/inbox` **Promotions** tab (and mirrors to a Notion "Promotions" DB via native Notion MCP for mobile review).
5. **Approval.** Edmund hits approve/edit/reject on each proposal individually.
   - **Approve:** `skill_versions.status = approved`, `approved_at` set, the new markdown becomes the current Skill. `work_log` logs the promotion. Change appears in "what was learned this week."
   - **Edit:** Edmund tweaks diff, then approves. Same result.
   - **Reject:** `status = rejected, reason`. The underlying observations stay; the Librarian won't re-propose the same thing without new evidence.
6. **Librarian (next morning).** If Cordis had dropped the *same* observation across three different sessions without Corva catching it, the Librarian clusters them at 6am and files one consolidated proposal instead of three near-duplicates.

**What if Edmund ignores approvals?**

- Proposals have a TTL (default 14 days).
- After 7 days unreviewed, the daily recap surfaces the count ("8 promotion proposals waiting") but doesn't nag further.
- At 14 days, unreviewed proposals auto-expire to `status=stale`. The source observations remain; if the pattern repeats, it re-proposes, but noise doesn't accumulate.
- Nothing auto-merges. Ever. Edmund's discernment is the point.

**Skills involved by name:**
- `skills/session-retro/` — the Corva Skill.
- `skills/librarian/` — the daily clustering Skill.
- `skills/triage-inbox/` — Lev's Skill.
- Target Skills (the ones being updated): `skills/voice-tone/`, `skills/content-planning/`, `skills/lead-magnets/`, `skills/client-intake/`, `skills/priestley-framework/`, `skills/cordial-creator-framework/`, `skills/zpm-ministry-framework/`, `skills/meta-prompting/`.

---

## 4. Surfacing Skills (Pillar 5)

Three concrete daily/weekly Skills that make the system feel alive. All run as Claude scheduled tasks; all read the shared brain; all post to the dashboard home card and mirror a condensed version to Notion.

### 4.1 Daily Recap — "What you pushed forward"
- **Runs:** every evening at 9pm local.
- **Reads:** today's `work_log` grouped by `project`; `sessions` summaries; any `skill_versions` approved today.
- **Output sketch:**
  > **Today — Fri Apr 17**
  > • **Cordial Catholics:** outlined 2 shorts, approved 1 voice-tone update.
  > • **ZPM:** 1 voice memo transcribed (23 min) — ingested as reference.
  > • **Client (Liv Harrison):** no activity (last touched 4 days ago).
  > • **Faith & AI Project:** 1 research capture filed.
  > • 3 promotion proposals waiting. Review: `/inbox/promotions`

### 4.2 Last-Touched Heatmap — project freshness
- **Runs:** morning brief (7am) and rendered live on the dashboard home.
- **Reads:** `work_log` grouped by `project`, max(`created_at`).
- **Output sketch:** a six-row strip for the six ventures (EM brand, Cordial Catholics, ZPM, Real+True, Faith & AI, Digital Continent clients). Each row: days-since-last-touch, top action in last 7 days, a ghost row for "projects quiet >14d." The visible-by-default anti-neglect signal Edmund asked for.

### 4.3 Goal Progress — strategic objectives
- **Runs:** weekly on Monday 6am; refreshable on demand.
- **Reads:** `reference_docs` of type `goal` (Edmund's high-level OKRs/objectives, kept in one place per pillar 2); joined against `work_log` tagged with the relevant goal.
- **Output sketch:**
  > **Q2 goals — week of Apr 13**
  > • Grow Cordial Catholics to 30k subs — +217 this week, on pace. 2 videos shipped.
  > • Launch ZPM v1 intake flow — 0 work_log entries this week. Stalled.
  > • Cordial Creator Framework e-book — +3 captures filed to the Skill; no outline movement.
  > Suggested focus this week: ZPM intake.

These three cost little to build because they're SQL + markdown templates. The data is already there once Phase 1.5 lands.

---

## 5. Approval UX — where it lives

**Options considered:**
- (a) **Dashboard `/inbox/promotions`** — custom tab in the existing dashboard. Table of proposals with diff view, approve/edit/reject buttons.
- (b) **Notion DB** — proposals written as pages in a Notion "Promotions" database. Edmund reviews on phone.
- (c) **Claude chat inline** — Corva asks inside the current session, approvals handled via MCP tool calls.
- (d) **Slack-style channel** — an `agent_messages`-backed workspace message with buttons.

**Recommendation: (a) with (b) as mirror.**

The dashboard is the only surface that can show a diff cleanly and render a list of pending items in one glance. Notion mirror exists because Edmund captures on iPhone and won't always have the dashboard open. Claude chat inline (c) stays for *immediate* one-off promotions ("approve this one now?"), but the accumulation happens in (a). Slack-style (d) is too noisy — promotions aren't conversational, they're reviewable work.

**Rule:** the dashboard `/inbox/promotions` is the single source of truth. Notion is a read-lite mirror. Approving in Notion flips a checkbox that a Supabase webhook syncs back.

---

## 6. MVP — what ships first

Minimum to feel the loop. One capture → one observation → one approval → one Skill update → one surfacing.

1. **One agent: Cordis.** Runs in CEO Desk project. Writes `sessions` + `work_log` + `observations`. No other agents yet.
2. **One meta-Skill: Corva (session retro).** Fires at session end, drafts one `skill_versions` proposal against a single starter Skill — `skills/voice-tone/SKILL.md` (the most over-referenced and most concrete).
3. **One approval path: dashboard `/inbox/promotions` tab.** No Notion mirror yet. Just a table with diff + approve/reject.
4. **One surfacing Skill: Daily Recap.** Evening cron. Reads today's `work_log`, emails/Notions Edmund a 5-line summary with "N promotions waiting."

That's the loop in miniature. Edmund should be able to:
- Talk to Cordis in CEO Desk.
- See a promotion proposal that evening.
- Approve it from the dashboard.
- See it referenced the next morning in the daily recap.

Once that loop feels right, add Lev (ingest) next — because voice memos are the highest-pain capture type — then Axel and Hild, then the Librarian once observation volume justifies clustering.

**Estimated scope:** Cordis is a system prompt + tool allowlist (no new code). Corva is a Skill (markdown + a small query). `/inbox/promotions` is one new table + one page in the existing dashboard. Daily Recap is one scheduled task. This is days, not weeks.

---

## 7. Risks & Anti-Patterns

**Things that would make this over-engineered (principle: will not outbuild Anthropic):**

- **Custom orchestration layer.** If we find ourselves writing a "coordinator agent that decides which sub-agent gets the message," stop. Claude's context-switching (projects, Skills) handles this. Agents = system prompt + tool allowlist, not a directed graph.
- **Agent-to-agent chat as a primary mechanism.** `agent_messages` is for Edmund watching the Slack-style workspace, not for agents negotiating. Agents coordinate through the **shared brain** (Supabase tables) — they write observations, later Skills read them. Async, not sync.
- **A "promotion inbox" with more UX than the actual product.** If more than one tab deep, it's wrong. List + diff + three buttons.
- **Auto-approval thresholds.** Tempting to say "high-confidence observations auto-merge." Don't. Approval is the point of the pillar; the system's job is to *propose well*, not to decide.
- **Per-venture agents.** One agent per venture (six named content agents) is cosplay. One Axel for all content; the venture is metadata on `work_log.project`.
- **Making Skills smart enough to rewrite each other without review.** If `skill_versions` can be written without a human-or-scheduled-Skill in the loop, the system can drift.
- **Rebuilding what Claude Skills / Projects already give us.** Skills *are* the packaging mechanism. Don't invent a parallel one.

**Smell test:** if an agent doesn't write to `sessions` or `work_log` or `observations` or `skill_versions` or `reference_docs`, what does it do? If the answer is "thinks" or "coordinates," it shouldn't exist.

---

## 8. Open Questions (for Edmund)

1. **Session scope granularity.** Is a "session" a single Claude conversation, or a logical block of work that may span conversations? Corva's retro trigger depends on this.
2. **Who writes observations — agent or Skill?** If Cordis writes them inline during the chat, they're noisy but fresh. If Corva writes them all at retro, they're clean but delayed. Proposal: both — Cordis writes `{confidence: ≤0.6}` inline, Corva consolidates at close.
3. **Should Corva propose updates to `reference_docs` too, or only `skill_versions`?** Proposal says yes; but reference docs (goals/values/KPIs) may deserve stricter gating.
4. **Does the Librarian actually need to exist in v1?** If Corva does solid retros, daily clustering may be premature. Could wait for observation volume to justify it (>50/week).
5. **What happens to `observations` from conversations that touch a Skill Edmund doesn't have yet?** Proposal: they become "Skill candidates" — a sub-queue of "we saw this theme 5 times, want to make it a Skill?"
6. **Notion Promotions DB — is the bidirectional sync worth the cost, or is one-way (Supabase → Notion read-only, approve in dashboard only) cleaner?** Leaning one-way for v1.
7. **Are ZPM and Real+True single-project or multi-project under Hild?** Affects `work_log.project` enumeration and the last-touched strip.
8. **Do we version Skills as git commits in `/skills/` or as rows in `skill_versions`?** Both? Rows in Supabase for the query/audit path; git for the portable Skill packaging Anthropic expects. Double-write at approval time.

---

*End of brainstorm. Pick the shape you want; next step is writing the MVP plan (Cordis + Corva + `/inbox/promotions` + Daily Recap) into `/dashboard/docs/superpowers/plans/`.*
