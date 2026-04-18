# Agent Scope Reassignment — 2026-04-17

**Author:** Autonomous dispatch by Edmund.
**Context:** Three functional needs from the rebuild (W4.1, W5.1, W7.1) were originally scaffolded onto the wrong canonical agents (Lev/Axel/Hild), quarantined at `/Users/edmundmitchell/factory/architecture rebuild 2026-04-17/04-audit/2026-04-17-agent-misalignment-quarantine/`. This memo records the reassignment to the correct canonical owners.

## What I read

All 8 canonical agents at `COWORK_PATH/Agent Personalities/agents/*` — both `identity.md` and `CLAUDE.md` for each.

| Folder | Name | Current scope (as agent describes itself) |
|---|---|---|
| `cordis/` | Cordis | Personal AI companion + orchestration hub; routes to specialists; continuity + memory. |
| `ceo/` | Tokamak | Strategic executive advisor; frameworks (OKRs, P&L, revenue filter); challenges assumptions; decision capture. |
| `marketing/` | Lev | Brand strategist & audience growth; hooks, funnels, emotional resonance; platform dynamics; audience-first. |
| `content/` | Corva | Content strategist & production; editorial collaborator; voice fidelity; YouTube scripts, newsletters, LinkedIn, blog; Cordial/ZPM/Prophet-King-Priest frameworks. |
| `research/` | Feynman | Knowledge analyst & signal processor; confidence labels; source attribution; "scrape, ingest, search, cross-reference"; signal categories already listed. |
| `developer/` | Axel | Technical implementation specialist; reads before writing; verifies deployments; stack = Next.js/Python/LangGraph/Vercel/Railway. |
| `designer/` | Hild | Visual design specialist & art director; spec-first; brand coherence; canonical platform element names. |
| `pm/` | Kardia | Project manager & delivery lead; holds the work; status, blockers, accountability; already has EM/ZPM/R+T/FAI + CFCS/CP/Liv Harrison in Active Business Context. |

## Routing decisions

### Need 1 — Voice memo + YouTube + signals + RSS ingest orchestration + observation clustering → **Feynman**

Feynman's CLAUDE.md already says "Use tools to scrape, ingest, search, and cross-reference — not just summarize" and already enumerates Signal Categories (Catholic Creator, Parish Ministry, Creator Economy, YouTube Strategy, Faith & AI) — the same taxonomy the signals-ingest pipeline classifies. Her identity is "processes large amounts of information and surfaces only what's actionable; everything else gets filtered" — which is exactly what ingest + Librarian clustering is. Confidence labeling (Confirmed/Strong Signal/Speculative) maps cleanly onto the `observations.confidence` requirement (≤0.5 for emergent-theme flags; never ≥0.7). No other canonical agent has "ingest" or "signals" anywhere in their existing scope.

### Need 2 — Ideation + drafting + repurposing → **Corva**

Corva's identity opens with "Corva is Edmund's editorial collaborator — the one who helps shape raw ideas into pieces." Her CLAUDE.md already lists Cordial Communication Framework, ZPM Prophet-King-Priest, Authority vs. Power as "Edmund's original IP. Write about them, write from them, never flatten them into generic business language." Her Voice Profile section is literally the voice guide that a drafting agent must apply. Handoff triggers already include `draft`, `newsletter`, `YouTube script`, `blog`, `writing`. Adding repurposing + IOC + workspace-writes is a narrow, additive clarification — not a scope change. The quarantined Axel scaffold's drafting responsibilities were effectively a rewrite of Corva's existing charter.

### Need 3 — Client ops (CFCS / Liv / Culture Project / Lisa + ZPM + Real+True) → **Kardia**

Kardia's CLAUDE.md Active Business Context already enumerates every client and venture in scope: "Edmund's own ventures: EM, ZPM, R+T, FAI. Client work via Digital Continent: CFCS, CP, Liv Harrison." Her identity: "She knows what's in flight, what's slipping, and what needs a decision to unblock" — the client-ops remit in one sentence. Her Priority Filter is already the revenue-filter cascade used for project triage. Adding project-tagging conventions, `artifacts.client` slugs, `due_date` discipline, and weekly drift checks is a tightening of her existing mechanics — not a new role. No other canonical agent has "delivery tracking" or "accountability" as their core responsibility.

## What changed

| Agent | File edited | Lines added | Section marker |
|---|---|---|---|
| Feynman (`research/`) | `CLAUDE.md` | ~26 | `## Rebuild 2026-04-17 extensions` |
| Corva (`content/`) | `CLAUDE.md` | ~22 | `## Rebuild 2026-04-17 extensions` |
| Kardia (`pm/`) | `CLAUDE.md` | ~38 | `## Rebuild 2026-04-17 extensions` |

All additions are appended above the existing `## Reference` block, preserving every original section. No identity.md or soul.md changes. No new folders.

Each extension block documents:
1. New responsibilities (3–6 bullets).
2. Edge Functions the agent calls (and which it explicitly does not deploy).
3. Tables the agent reads / writes / is explicitly not allowed to write.
4. New routing keywords.

## What's deferred

- **Cordis routing table** — Cordis's top-level routing table (in `cordis/CLAUDE.md` and `cordis/identity.md`) still uses the short handoff-trigger summaries. The three extended agents gained new keywords, but I did not extend Cordis's routing table to mirror them — Cordis's existing entries (`research, signal, trend…`; `content, draft, publish…`; `project, milestone, delivery…`) already route the new keywords correctly through topical proximity. A future pass can enumerate the new keywords explicitly if routing mis-hits.
- **Cordis's own `capture()` behavior** — Cordis is still described as an orchestration hub; whether Cordis should call `capture()` directly for chat-origin captures versus always routing to Feynman is a separate question Edmund should settle once the capture pipes are observed under load.
- **Soul files** — untouched. None of these additions warranted a voice/tone change.
- **Marketing/Axel/Hild canonical scopes** — unchanged. The quarantined scaffolds are quarantined, not deleted. If Edmund later wants a distribution-specialist agent (the original marketing-Lev scaffold idea) or a dedicated ingest agent separate from Feynman, that's a future specialist-spawn (W8.x) decision.
- **Cordis as client-ops router** — Kardia does not currently reach into the Cordis routing table automatically; Edmund should sanity-check that when he says "client update on CFCS" the handoff lands on Kardia, not Cordis-stays-in-orchestration-mode.

## Files changed

- `/Users/edmundmitchell/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork/Agent Personalities/agents/research/CLAUDE.md`
- `/Users/edmundmitchell/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork/Agent Personalities/agents/content/CLAUDE.md`
- `/Users/edmundmitchell/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork/Agent Personalities/agents/pm/CLAUDE.md`
- `/Users/edmundmitchell/factory/architecture rebuild 2026-04-17/06-handoffs/backlog.md` (W4.1 / W5.1 / W7.1 entries updated + W4.1b / W5.1b / W7.1b added)

## What Edmund should sanity-check

1. **Routing in practice.** When he says "ingest the voice memo," does the handoff hit Feynman? When he says "draft the newsletter," Corva? When he says "CFCS status," Kardia? If any miss, the Cordis routing table needs the new keywords spelled out.
2. **Feynman voice vs. ingest reporting.** Feynman's identity is "lead with the finding, not the method, label confidence." Her ingest-reporting style from the quarantined Lev scaffold was outcome-oriented ("Transcript landed as work_log, 1,240 tokens…") — compatible, but Edmund should flag if she over-applies confidence labels to mechanical ingest reports.
3. **Kardia scope surface area.** Client ops adds a lot. Kardia now owns delivery tracking *and* client stewardship *and* the existing venture PM. If she feels overloaded in practice, splitting off a `clients/` specialist is the natural W8.x move.
4. **No ability without pipes.** These edits give the agents *ability*; they do not execute the underlying plumbing. W4.2 (voice-memo capture path in `capture()`), W6.1 (Librarian scheduled task), W7.2 (client project scaffolding) still need to be built for the new responsibilities to be real.

## Addendum: Cordis merge (2026-04-17, later same day)

The "deferred — Cordis routing table" item above is now closed. A separate autonomous run merged two divergent Cordis definitions into one canonical version at `COWORK_PATH/Agent Personalities/agents/cordis/` and deleted the stale factory copy at `/factory/agents/cordis/`.

As part of that merge, Cordis's routing table was extended with the new handoff keywords from this decision:

- **Corva** gained `outline, script, repurpose, carousel, show notes, essay, edit` on top of the existing content-family keywords.
- **Feynman** gained `voice memo, transcribe, ingest, youtube, rss, feed, clustering, observation` on top of the existing research-family keywords.
- **Kardia** gained `CFCS, Liv, Culture Project, ZPM, Real + True, client status, deliverable` on top of the existing PM-family keywords.

Tokamak / Lev / Axel / Hild rows unchanged.

There is now one canonical Cordis (the iCloud version) and it is the one the dashboard agent loader reads. Full write-up: `/Users/edmundmitchell/factory/architecture rebuild 2026-04-17/06-handoffs/autonomous-runs/2026-04-17-cordis-merge.md`.
