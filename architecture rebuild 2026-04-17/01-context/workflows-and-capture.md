# Workflows & Capture Types

**Status:** Walkthrough captured 2026-04-17. Living doc.

## Why this doc exists

The audits captured *what tools exist* and *what tables hold what*, but not *what Edmund actually captures in a typical week and what he wants to happen to it next*. That gap drives the capture function's type handling, metadata schema, and triage rules.

This is also the home for the three vision patterns that require capture-and-feedback loops — SOPs as Skills, self-improving loops, and proactive surfacing. See `vision-and-priorities.md` for the full framing.

---

## Primary patterns confirmed (2026-04-17 walkthrough)

Key takeaways from Edmund's workflow dump:

1. **CEO Desk Claude project is the primary capture surface today.** New chat → dump. Not Notion, not a dashboard — a Claude project. The rebuild's dashboard should *extend* this, not replace it.
2. **Claude chat across desktop + iPhone is the continuity problem.** Claude projects partially solve it. A dashboard would solve it fully. This is the core dashboard value proposition.
3. **Voice memos are a major input** — iPhone Voice Memos app, Claude chat, or Rode Wireless Go for 12–30 min dictations. **Never plays back — always transcribed immediately.** A dedicated voice-capture path is high-leverage.
4. **"Sort later" = Claude goes into Notion and sorts.** Not manual review. This is an existing Skill worth formalizing: *Triage Inbox*.
5. **Session retro → promotion** is the killer SOP-as-Skill pattern. End of session: agent suggests "I can update these docs/Skills/SOPs based on this conversation." Edmund approves individually.
6. **Proactive surfacing shape is clear:** visual progress on high-level goals, daily "what you pushed forward" recap, last-touched-per-project, last-added-to-each-Skill.
7. **⚠️ Hosting/security is a live concern.** Edmund previously built a Telegram capture app; Railway crashed constantly. He's questioning whether hosting the dashboard on Vercel (with captures flowing through a public URL) is the right privacy model. Telegram's perceived advantage is security. This gets its own open question (see `03-decisions/open-questions.md` Q11).
8. **Meta-prompting is an existing Skill** — brain dump → agent structures → paste. Worth naming.
9. **Content pipeline is concrete:** idea → research → outline → scripting → production → repurposing. IOC system in the archive has the canonical version.

---

## Three capture-driven patterns from the vision

These shape the capture schema as much as the file types do.

### Pattern A — SOPs as Skills (pillar 3)
Each of Edmund's repeatable approaches (voice/tone, content planning, lead magnets, content strategy, framework application) is a **Skill** in `/skills/<topic>/`. The Skill has: the approach, references, changelog, version. Captures relevant to a Skill get *proposed* as updates — Edmund decides whether to merge.

### Pattern B — Self-improving loops (pillar 4)
Agents write observations to an `observations` / `promotions` table. Higher-level Skills periodically pull from this table, promote patterns, and update themselves (with approval gate). Every captured item might trigger an observation.

### Pattern C — Proactive surfacing (pillar 5)
Claude scheduled tasks + Skills that run on cadence and push to Notion / dashboard / notification. Needs the rich-capture data (pillar 1) to work at all.

**Rich capture (pillar 1) unlocks pillars 4 and 5.**

---

## Real workflows & capture types (answers 2026-04-17)

### A. Capture inventory

**A1 — First capture of the day from own brain.**
CEO Desk Claude project → open a new chat → dump. That's the first place he always goes.

**A2 — Last web capture / do you come back?**
Returns to them all the time. Examples:
- Open Brain guides and prompts
- shadcn/ui component libraries he wants filed for later or integrated into code
- Links he sends to Claude to log in Creator Engine as content ideas, or add as references/citations on essays/articles/newsletters in progress

**A3 — Voice memos.**
Yes, heavy user. Three paths:
- iPhone Voice Memos app
- Directly into Claude chat
- Rode Wireless Go clipped to shirt → 12–30 min dictations of entire playbooks or research ideas

**Never plays memos back. Always immediately transcribed.** Big design implication: transcription must be part of the capture path, not a separate manual step.

**A4 — Screenshots.**
- iPhone: pile up in Photos app
- Desktop: pile up on Desktop
No active triage today.

**A5 — Email captures.**
Newsletters worth saving as swipe files → forward to self OR get the web view link → throw into Creator Engine.

**A6 — PDFs / docs / decks.**
Pile up in Downloads folder. Often moved to Google Drive — sometimes organized, sometimes not. Google Drive search is the fallback retrieval method.

**A7 — Reusable prompts.**
Not heavily reused. Grabbed from guides, used 1–4 times. Saved either in Notion (Residence Calendar, Creator Engine) or just in conversation history. **Meta-prompting pattern is the bigger story:** brain dump → ask agent to turn it into a structured prompt → copy/paste the result.

**A8 — Other inputs.**
- B-roll video footage (iPhone + Canon EOSR)
- Riverside.FM meeting recordings (for repurposing into social content, article drafts, Instagram reels outlines)
- iPhone Voice Memos app as a backup meeting recorder when in-person or when the other party is already recording

**Want:** log voice memos in the same URL / web app dashboard as everything else. Single entry point.

### B. Sources

**B9 — Ranked by frequency.**
- **Tied #1:** Claude desktop app + Claude iPhone app
- Last month: more Claude Cowork + Claude Code
- Often moves between computer and phone → Claude projects partially handle continuity. **Dashboard would handle it fully.**

**B10 — Meetings vs. deep-work.**
(Didn't answer directly, but the meeting recording patterns in A8 suggest meetings produce high-volume capture — recordings + transcripts need a home.)

### C. Destinations & downstream actions

**C11–C12 — "Sort later."**
"Sort later" = ask Claude to go into Notion and help sort. Claude tags, enriches, prioritizes, moves things around, and surfaces anything that needs Edmund's attention (content questions, emails, tasks, projects).

This is a de-facto Skill already — *Triage Inbox*. Worth formalizing so it runs on cadence or on a button click from the dashboard.

**C13 — Must-not-break pipeline.**
(Didn't call one out explicitly, but the CEO Desk → new-chat → dump flow is clearly load-bearing and must survive the migration.)

### D. Real workflows

**D14 — Content pipeline.**
`idea → research → outline → scripting → production → repurposing` (into multiple formats: long-form, social, podcast, reels, etc.).
**The IOC system in the archive** has the canonical version — worth digging up to model this properly.

**D15 — Client work (Digital Continent — CFCS, Liv Harrison, Culture Project).**
Lives in Claude projects. Each client has its own project context.

**D16 — ZPM / Real+True.**
(Not directly answered — default to "active-but-lower-priority" unless flagged otherwise.)

**D17 — Meetings.**
Often recorded on Riverside.FM. Transcripts get uploaded to Notion (Meetings DB) for repurposing. Voice memo app as backup for in-person.

**D18 — Reading / watching / listening.**
Capture in Claude chat → feed over to Notion.

**Desired future state:** ingesting YouTube videos into transcripts and then into playbooks, research, frameworks, IP. This is a specific Skill Edmund wants built.

### E. Friction & aspirations

**E19 — #1 "I wish it did this automatically."**
Captures are everywhere; Edmund has to tell Claude *where to look* every time. Wants: better automatic routing + proactive reminding of high-level objectives, priorities, tasks. Plus **motivational progress/metrics** — streaks, momentum, visible completion.

**E20 — #1 "I keep losing track of X."**
Random non-urgent tasks and deadlines. Things that aren't emergencies but matter eventually.

**E21 — If v1 inbox nails ONE capture type.**
(Not explicitly picked, but the voice-memo-to-transcription path is the most under-served and most frequently mentioned. Strong candidate.)

**E22 — Proactive nudges.**
- Visual display of where he is on high-level goals / strategy / defining objectives
- Daily recap of progress: *"you pushed X forward today"* — maintains momentum after distractions
- Last touched per project + last task checked + last core doc added to SOPs
- "You had an idea that nudged Z forward — here's where it landed"

### F. SOPs-as-Skills

**F23 — Top Skills to build.**
Skills scattered across workspaces today. Specific ones named:
- YouTube video → transcript → playbook / research / framework / IP extraction
- Social content outline generation
- (Plus implicit: content critique, client intake, Priestley framework application, lead magnet scoring — from earlier conversations)

**F24 — Written somewhere or in-head?**
Mixed. Some in other workspaces. **Biggest desired pattern:**

> End of session, Claude runs a retro on the conversation → suggests promotions to Skills/SOPs/core docs → asks for approval individually. "Based on this conversation, I can go update these things — approve?"

Plus cross-document awareness: agent recognizes "this connects to these other strategies, want me to update those too?"

---

## Design implications (what these answers shape)

| Answer | Shapes |
|---|---|
| CEO Desk = primary capture surface | Capture Edge Function must be callable as a Claude MCP tool from any Claude project, including CEO Desk. Dashboard is the triage/view layer, not the primary capture UI. |
| Voice memos never played back; always transcribed | Capture pipeline includes transcription step (Whisper / AssemblyAI / hosted Claude). Voice file → Supabase Storage → transcribe → treat result as text capture. |
| Sort later = Claude into Notion | Build a *Triage Inbox* Skill. Triggerable from dashboard or scheduled. |
| Session retro → promotion | End-of-session Skill that runs a retro, suggests updates, gates on approval. Needs `skill_versions` + `promotions` tables (already in thin-schema gaps). |
| Proactive nudges = progress visual | Dashboard home needs a "goals/progress" panel + "what happened today" recap card. Data comes from `work_log`, `sessions`, `skill_versions`. |
| Telegram lesson / privacy concern | New Q11 — hosting/security model for the dashboard. |
| Multiple Claude surfaces + project continuity | Strengthens Supabase-as-source-of-truth for session/context so any Claude surface (desktop/iPhone/Cowork/Code) sees the same state. |
| Meta-prompting pattern | Named Skill: *Structure a Brain Dump*. Low-cost to build. |
| IOC system reference | Action item: find it in the archive to model the content pipeline. |

---

## Thin-schema gaps (from pillar 1 — rich data capture first)

Edmund's explicit ask: new tables so we *have* the data. Per the vision doc:

| Missing today | Why we need it | Likely table |
|---|---|---|
| **Session-level activity** | Proactive surfacing needs "last touched ZPM" / "active projects this week" | `sessions` (id, scope, started_at, ended_at, summary) |
| **Chat history beyond `agent_messages`** | `agent_messages` is a flat log with no session grouping | Add `session_id` + retention + search |
| **Token logs per session** | Cost tracking exists (`agent_cost_log`) but not per-session | Join to sessions |
| **Work logs** | What actually got done, not just scheduled tasks | `work_log` (id, session_id, type, summary, outcomes) |
| **Observations / promotions** | Self-improving loops (pattern B) | `observations` (who, what, confidence, promoted_to) |
| **Skill changelogs** | SOPs-as-Skills (pattern A) — version history | `skill_versions` (skill_id, version, diff, approved_by, approved_at) |
| **Reference doc store** | One-source-of-truth (pillar 2) for goals/values/KPIs/frameworks | `reference_docs` (id, type, slug, content, updated_at) |

---

## Gaps not yet discussed (worth checking later)

- Calendar capture (meetings that weren't recorded)
- Asana tasks ingesting into work_log
- Content asset IDs (photos, videos, events) — Edmund mentioned these as supporting infra
- How Google Drive fits (catch-all? mirrored to Supabase Storage? searched live?)

## Legacy walkthrough prompt (kept for reference)

> "Walk me through a typical week. What do you capture, where does it come from, where does it go, and what do you wish happened next?"
