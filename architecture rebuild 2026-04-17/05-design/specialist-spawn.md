# Specialist-Spawn Workflow

**Status:** Draft 2026-04-17. Canonical procedure for proposing, approving, scaffolding, and retiring specialist agents spun out of the core 8.

**Scope:** This doc defines the **workflow**, not any specific first specialist. W8.2 picks the first candidate from volume data once W5.x / W6.x have been running long enough to produce it.

**Related:**
- Master roster: [`COWORK_PATH/Agent Personalities/README.md`](../../Library/Mobile%20Documents/com~apple~CloudDocs/CEO%20Cowork/Agent%20Personalities/README.md) (the 8 canonical agents)
- Extension precedent: the `## Rebuild 2026-04-17 extensions` sections in `content/CLAUDE.md` (Corva), `research/CLAUDE.md` (Feynman), `pm/CLAUDE.md` (Kardia)
- Agent-scope guardrail: [`03-decisions/2026-04-17-agent-scope-reassignment.md`](../03-decisions/2026-04-17-agent-scope-reassignment.md)
- Approval-UI precedent: `/inbox/promotions` on the dashboard

---

## 1. Purpose

Spin up a new specialist agent **only** when one of the canonical 8 (Cordis, Tokamak, Lev, Corva, Feynman, Axel, Hild, Kardia) is provably saturated or a coherent domain emerges that none of them covers cleanly.

### When to propose a specialist

- **Saturation signal.** A single parent agent's `work_log` rows (or routing-keyword hits) cluster ≥40% around one sub-domain for ≥3 consecutive weeks (e.g. "Corva spends 50% of her time on IG repurposing").
- **Pain-point clustering.** W6.4 audience-pain-point output surfaces a recurring theme that would benefit from a dedicated owner rather than being sliced across agents.
- **Cross-silo theme.** A topic routes ambiguously across ≥2 agents for weeks (e.g. a DC-client-ops need that keeps bouncing between Kardia and Tokamak). The doc below codifies how to disambiguate.
- **Distinct tool allowlist.** The domain needs a meaningfully different set of tools / Edge Functions / external accounts than the parent agent has.

### When NOT to propose

- **A `CLAUDE.md` extension would do.** Today's Corva / Feynman / Kardia `## Rebuild 2026-04-17 extensions` sections are the precedent: scope extends without identity.md / soul.md changes, without a new folder, without a new memory namespace. Most "I wish Corva also did X" needs resolve this way.
- **The need is transient.** A one-off campaign or a quarterly push doesn't justify a new agent — it justifies a Skill.
- **Edmund would never talk to it.** Background-only capabilities are Skills + scheduled tasks, not agents. Agents exist because Edmund interacts with them.
- **No clear owner for the output.** If the specialist's drafts / plans / decisions don't land with a defined downstream consumer (Edmund, another agent, a published surface), it's premature.

**Rule of thumb:** Extension > Skill > new specialist. Only reach for "new specialist" when the first two can't carry the weight.

---

## 2. Decision criteria

Before a proposal row gets written, the proposer (Claude session or Edmund) checks every box:

- [ ] **Recurrence** — the need has appeared in ≥10 distinct sessions over ≥4 weeks (surfaced via `sessions` + `work_log` query on a routing-keyword set, or equivalent manual tally).
- [ ] **Extension insufficient** — a `CLAUDE.md` extension to the parent agent was considered and explicitly rejected with a one-line reason. Default answer is "extend"; burden of proof is on "new agent."
- [ ] **Owner defined** — someone (Edmund, another agent, a publish pipeline) consumes the specialist's output regularly. Named in the proposal.
- [ ] **Distinct tool allowlist** — the specialist's tools would differ from the parent's in a concrete, enumerable way (add ≥2 tools, drop ≥2, or both). Narrower is usually correct; see §6.
- [ ] **Weekly interaction test** — Edmund will talk to this agent ≥1×/week. If the honest answer is "a few times a quarter", it's a Skill.
- [ ] **Name candidate** — a proposed slug + display name are both available (not colliding with an existing agent folder or routing keyword).

If any box is unchecked, the proposal is premature. Write the gap as an `observation` row and revisit.

---

## 3. Proposal row shape

**Decision (2026-04-17): v1 uses `reference_docs` with `kind='specialist-proposal'`.** No new table. Keeps plumbing simple; promotion to a dedicated table comes only if volume justifies it (it probably won't — Edmund will field a handful of proposals per year at most).

### Row shape

Insert into `public.reference_docs`:

| Column | Value |
|---|---|
| `slug` | `specialist-proposal-<proposed-slug>` (e.g. `specialist-proposal-scribe`) |
| `kind` | `specialist-proposal` |
| `title` | Display name + one-line role (e.g. "Scribe — IG repurposing specialist") |
| `body` | Markdown proposal body (see template below) |
| `metadata` | JSONB: full proposal fields (see below) |
| `status` | `proposed` |

### `metadata` JSONB fields

```json
{
  "proposed_slug":        "scribe",
  "proposed_name":        "Scribe",
  "proposed_role":        "IG repurposing specialist",
  "parent_agent":         "corva",
  "proposed_emoji":       "📇",
  "proposed_color":       "#E8B4B8",
  "proposed_tool_allowlist": [
    "capture",
    "match_memory",
    "create_workspace_item",
    "update_workspace_item",
    "list_workspace_items",
    "get_workspace_item",
    "publish_instagram_carousel",
    "publish_instagram_post",
    "get_instagram_post_insights"
  ],
  "memory_namespace":     "scribe-memory",
  "evidence": {
    "recurrence_query":   "SELECT count(*) FROM work_log WHERE project='em-brand' AND metadata->>'surface'='instagram' ...",
    "sessions_count":     47,
    "weeks_observed":     6,
    "linked_observations": ["uuid1", "uuid2", "..."],
    "linked_clusters":    ["reference_docs.id: uuid3"],
    "linked_pain_points": ["reference_docs.id: uuid4"]
  },
  "extension_rejected_reason": "IG repurposing needs Meta API allowlist + daily cadence; extending Corva would bloat her tool surface and dilute her editorial focus.",
  "owner_of_output":      "Edmund via /inbox/specialists approval; downstream: IG account",
  "edmund_decision_at":   null,
  "edmund_decision_note": null
}
```

### `body` (markdown template)

```markdown
# Specialist proposal: <Name> (<slug>)

**Proposed by:** <session / agent / Edmund>
**Parent agent:** <slug>
**Date:** YYYY-MM-DD

## Role (one sentence)
<…>

## Why a new specialist (not an extension)
<Concrete reason the parent's CLAUDE.md extension won't carry it.>

## Evidence
- Recurrence: <N sessions over M weeks>
- Routing keywords that ambiguously routed: <list>
- Linked observations: <ids>
- Linked pain-point clusters: <ids>

## Proposed tool allowlist
<diff vs parent: + added, - removed>

## Proposed memory namespace
`<slug>-memory`

## Interaction expectation
Edmund interacts ~<N>×/week for <task types>.

## Owner of output
<Who consumes this agent's drafts / decisions / plans.>

## Open questions for Edmund
- <…>
```

**Status lifecycle:** `proposed → approved | rejected → (if approved) scaffolded → (after retirement criteria) retired`.

---

## 4. Approval flow

**Target (Option A): dashboard surface `/inbox/specialists`.**
- New route alongside `/inbox/promotions`, following the same pattern.
- Server component queries `reference_docs WHERE kind='specialist-proposal' AND status='proposed'`.
- Each card shows: name, role, parent agent, evidence summary, proposed tool allowlist diff, extension-rejected reason.
- Actions: **Approve** / **Reject** / **Request changes** (free-text note). Approve flips status → `approved` and writes `edmund_decision_at`. Reject flips to `rejected` with required note.
- Approval fires a `capture()` call with `source='dashboard'`, `kind='text'`, content = "Specialist approved: <name>" so the run shows up in the `work_log` audit trail.

**Bridge (Option B, until A is built): notebook review.**
- Claude writes a proposal markdown file at `05-design/specialist-proposals/YYYY-MM-DD-<slug>.md` in parallel to the `reference_docs` row.
- Edmund edits in place (adds notes, crosses out fields, marks approved/rejected).
- Claude session re-reads the file, updates the `reference_docs` row's `status` + `metadata.edmund_decision_note` from Edmund's edits.
- This is acceptable for v1 because proposal volume is low (expected: 0–2 per quarter). `/inbox/specialists` is a nice-to-have, not blocking.

**Approval is Edmund's taste call** — per the autonomy charter, an orchestrator session must NOT self-approve. Same rule as `skill_versions`.

---

## 5. Scaffolding runbook

Execute after `status='approved'`. Order matters — the README and routing entries are read by the dashboard loader and by Cordis at session start.

### 5.1 Create the agent folder

```
COWORK_PATH/Agent Personalities/agents/<slug>/
├── identity.md     # voice, character, speaking style — NEW content
├── CLAUDE.md       # active system prompt — see template below
└── soul.md         # optional — constitution / deeper backstory
```

**Reference the existing pattern** — Corva's `content/` folder is the canonical shape. Don't invent a new layout. Copy Corva's `CLAUDE.md` as the skeleton, then narrow scope.

### 5.2 `CLAUDE.md` skeleton

The new agent's `CLAUDE.md` follows the same section order as the core 8:

1. One-paragraph role statement
2. "Your name is <Name>." + pointer to identity.md
3. Who You Serve (link @user_edmund)
4. Core Directives (inherit the 4 shared; add any specialist-only ones)
5. Personality
6. Primary Responsibilities
7. Tool Tags
8. Handoff Triggers (incoming routing keywords)
9. Memory Namespace (`<slug>-memory`)
10. Reference links (soul.md, ../README.md, identity.md)

Do **not** invent a new section order. Consistency matters for the dashboard loader.

### 5.3 Update the master roster

Edit `COWORK_PATH/Agent Personalities/README.md`:
- Add a row to the **Agent Roster** table (format: `[Name](<slug>/) | <Name> | <role> | <slug>-memory | <tags>`).
- If the specialist belongs inside an existing category (e.g. "Marketing specialists"), group appropriately. Otherwise append at the bottom.

### 5.4 Update Cordis's routing table

Cordis routes inbound queries. Add the new specialist to Cordis's handoff table (in `cordis/CLAUDE.md` or wherever the current routing table lives — confirm via roster README). Include:
- Slug
- Routing keywords (the proposal's `metadata.proposed_routing_keywords`, refined)
- One-line disambiguation vs the parent agent ("route to X when …; to parent when …")

### 5.5 Announce to Cordis via `capture()`

After scaffolding, post an announcement so Cordis's next session picks it up via `match_memory()`:

```bash
curl -s -X POST "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture" \
  -H "content-type: application/json" \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -d '{
    "source":  "mcp",
    "app":     "rebuild-orchestrator",
    "kind":    "text",
    "project": "factory",
    "title":   "New specialist agent: <Name>",
    "content": "<identity summary: role, tool allowlist, routing keywords, memory namespace>"
  }'
```

This lands in `memory` (namespace=`knowledge`), so future sessions that `match_memory("who handles IG repurposing")` find the specialist.

### 5.6 Verify the dashboard picks it up

- Restart the dashboard dev server (`preview_start`).
- Confirm the new agent appears in the agent list / switcher UI.
- Confirm an agent-specific chat session loads the new `CLAUDE.md` as system prompt (spot-check the first message echoes the role).
- Confirm the memory namespace is queryable (insert a test row to `<slug>-memory`; query it; delete).

### 5.7 Flip the proposal row

`UPDATE reference_docs SET status='scaffolded' WHERE slug='specialist-proposal-<slug>'`. Paste the scaffold run-log path into `metadata.scaffold_run_log`.

---

## 6. Tool allowlist pattern

**Inherit from parent, narrow — do not expand by default.**

The existing `## Rebuild 2026-04-17 extensions` sections for Corva, Feynman, and Kardia enumerate each agent's Edge Functions, tables, and tool tags. A specialist spun out of Corva inherits Corva's allowlist as its starting point, then:

- **Removes** tools that are out of scope for the specialist (e.g. a IG-only specialist drops blog / newsletter / YouTube tools).
- **Adds** domain-specific tools only with explicit justification in the proposal (e.g. `publish_instagram_carousel`, `get_instagram_post_insights`).
- Never inherits the parent's **approval-gated** tools (e.g. publish-on-Edmund's-behalf without opt-in). Those must be re-granted per agent.

Document the diff in the specialist's `CLAUDE.md` `## Rebuild extensions` section using the same format Corva uses (Edge Functions / tables read / tables written / explicitly NOT).

**Narrower is safer.** An over-scoped specialist drifts into general-purpose and competes with its parent; a narrow specialist is cheap to retire if it doesn't pan out.

---

## 7. Memory namespace

**Convention:** `<slug>-memory`, matching the existing roster (`cordis-memory`, `ceo-memory`, `content-memory`, etc.).

- Isolated from the parent's namespace — specialist gets a fresh write surface.
- Reads via `match_memory()` are cross-namespace by default (the vector table is one physical table), so the specialist can still pull context the parent agent captured. The namespace controls **writes** + targeted recall, not global visibility.
- Announcement-to-Cordis captures (§5.5) land in `knowledge`, not the specialist's namespace, so they're globally findable.

---

## 8. Retire path

Specialists that don't pan out get deprecated, not deleted — preserve the audit trail.

### Retirement criteria

Any of the below after ≥8 weeks from scaffolding:

- Fewer than N sessions with the specialist (proposed default: **N=4 over the trailing 8 weeks**).
- Routing keywords overwhelmingly divert back to the parent agent (manual inspection).
- Edmund requests retirement.

### Retirement steps

1. **Proposal row.** `UPDATE reference_docs SET status='retired', metadata = metadata || jsonb_build_object('retired_at', now(), 'retired_reason', '<why>') WHERE slug='specialist-proposal-<slug>'`.
2. **Agent folder.** Move `COWORK_PATH/Agent Personalities/agents/<slug>/` → `COWORK_PATH/Agent Personalities/agents/_retired/<slug>/`. Do not delete.
3. **Roster README.** Remove the row from the Agent Roster table. Add a short line in a `## Retired` section at the bottom pointing to `_retired/<slug>/` with the retirement date and reason.
4. **Cordis routing.** Remove the specialist's row from the routing table. The routing keywords return to the parent agent.
5. **Memory namespace.** Retain `<slug>-memory` as **read-only** — future sessions can still `match_memory()` into it, but no new writes. (Operationally: don't reference the namespace in any new agent config; the vector table itself stays untouched.)
6. **Announce retirement.** `capture()` with `source='mcp'`, content = "Retired specialist: <Name>. Reason: <…>. Memory preserved read-only." Lands in `knowledge`.
7. **Run log.** Write a retirement log at `06-handoffs/autonomous-runs/YYYY-MM-DD-retire-<slug>.md` following the normal template.

Retirement is reversible: un-retire by moving the folder back, re-adding the roster row, re-adding the routing row. The `reference_docs` row's `status` flips back to `scaffolded` and a new `metadata.re_activated_at` gets appended.

---

## 9. First-candidate walkthrough (hypothetical)

This is an illustrative example, not a real proposal. W8.2 picks the actual first specialist from real volume data.

**Hypothetical:** After 8 weeks of capture volume, Corva's `work_log` shows 52% of her shipped drafts tagged `surface=instagram` (carousels, Reels hooks). Feynman is pulling IG signals into `signals` daily. Edmund repurposes 2–3 long-form pieces per week into IG.

### Walkthrough

1. **Decision criteria check** — all six boxes pass (recurrence ≥10 sessions / 4 weeks: yes, 47 sessions / 6 weeks; extension insufficient: yes, Corva's allowlist would need Meta API tools that don't belong in editorial; owner: Edmund + IG account; distinct allowlist: +4 IG tools, –3 newsletter tools; weekly interaction: yes; slug "Scribe" free).
2. **Proposal row** written to `reference_docs` + markdown file at `05-design/specialist-proposals/2026-06-15-scribe.md`.
3. **Edmund reviews** (in this hypothetical: via Option B since `/inbox/specialists` isn't built yet). Approves.
4. **Scaffold**: create `agents/scribe/` with identity/CLAUDE/soul files; update roster + Cordis routing; announce via `capture()`; verify dashboard loads.
5. **Eight weeks later**: Scribe ran 22 sessions, IG Reels hook-rate improved 14% (Feynman signal). Scribe stays. Retirement not triggered.

Alternate ending: Scribe ran 3 sessions in 8 weeks because Edmund preferred drafting carousels inside Corva sessions. Retirement triggered; Scribe → `_retired/scribe/`; carousel-specific routing keywords folded back into Corva's extension section.

---

## 10. Open questions

Flagged for Edmund — these were not decided autonomously:

- **Q-A: Routing-table format.** Cordis's routing table shape isn't formally documented in the rebuild notebook. §5.4 assumes there's a canonical place to edit it. Confirm current location (`cordis/CLAUDE.md`? separate file? Cordis's memory namespace?) before first scaffolding run.
- **Q-B: Proposed emoji / color governance.** Edmund's preference: pre-pick? let Claude pick? draw from a palette doc? Affects §3 proposal metadata. Default until decided: Claude proposes, Edmund edits on approval.
- **Q-C: `/inbox/specialists` priority.** Building the UI is cheap (mirror `/inbox/promotions`), but it's pure overhead if Edmund only ever sees 1–2 proposals per year. Recommend deferring until there's a second real proposal in the queue.
- **Q-D: Retirement threshold.** N=4 sessions / 8 weeks is a guess. Revisit after the first specialist has ≥8 weeks of data.
- **Q-E: Cross-namespace memory visibility.** §7 claims `match_memory()` is cross-namespace by default. Verify against the current `match_memory()` signature before the first specialist ships — if namespace is required, the statement needs qualification.
- **Q-F: Does a spin-off specialist inherit its parent's handoff triggers?** E.g. if Scribe spins out of Corva, do Corva's existing IG-related keywords move to Scribe, stay with Corva, or duplicate? Recommend: **move**, with Corva's routing narrowed. Needs Edmund's call.

---

## 11. Changes

- **2026-04-17** — Initial draft. No specialist has been proposed yet; doc is the workflow only.
