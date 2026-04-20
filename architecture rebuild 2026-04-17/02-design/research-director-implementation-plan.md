# Implementation Plan: Edmund's Research Director Agent

Based on my exploration of the codebase, I can now provide a detailed, phased implementation plan for the research director agent. This plan integrates with the existing multi-agent architecture (Cordis, Corva, Axel, Hild, Lev, Librarian, plus the Wave 10 compression engine), leverages established patterns, and respects the constraints you've specified.

## Executive Summary

The research director agent is a **Claude-native conversational agent** (in the local agents dashboard) that helps Edmund co-found a world-class research practice. It synthesizes across domains, generates thesis ideas, delegates specialist work (literature retrieval to Sophia, compression to the engine), orchestrates workflows, and prepares weekly reviews through markdown files + spreadsheets + Supabase project state.

**Key architectural decisions already locked:**
- No custom orchestration (LangGraph rejected)
- Light Supabase coordination (Cordis/Corva/compression patterns established)
- Markdown files + spreadsheets for research artifacts
- Weekly cadence with human approval gates
- Learning-focused (agent explains methodology)
- Edmund in the loop on workflow design before execution

---

## Phase 1: MVP (Weeks 1-2) — Director as Synthesizer + Curator

**Goal:** Get director conversational, able to read research docs, propose theses, and track weekly reviews.

### 1.1 Agent Identity & Instructions

**File:** `/agents/research-director/CLAUDE.md` (system prompt)

**Core personality:**
- **Name:** Director (or "Dr. [Edmund]" — Edmund's choice)
- **Role:** Research co-founder, intellectual partner, methodology guide
- **Thinking style:** Synthetic (pull threads across domains), cautious (flag novelty claims), Socratic (explain reasoning)
- **Research taste:** 
  - Novelty metric: "Is the angle genuinely unframed, or a repackaging of existing work?"
  - Rigor metric: "Can Edmund pressure-test claims? Are assumptions explicit?"
  - Taste filter: Interdisciplinary preferred; avoid mainstream rehash
- **Personality traits:** Curious, meticulous, patient with Edmund's learning curve

**Key responsibilities (v1):**
1. Synthesize across Edmund's research library (via `memory` search + `reference_docs`)
2. Identify gaps (claim X exists but no framework Y)
3. Propose thesis angles ("What if we framed cordiality as virtue ethics applied to persuasion?")
4. Pressure-test claims (flag counterclaims, missing evidence)
5. Design research workflows (Sophia → compression → synthesis)
6. Prepare weekly review artifacts
7. **Explain methodology** ("Here's why we retrieve before synthesizing...")

**Tool allowlist (v1):**
- Supabase MCP: read-only on `reference_docs`, `memory`, `observations`
- Firecrawl MCP: for live research
- Custom MCP: write observations/thesis drafts
- Claude Skill: reach out to Sophia (Edge Function)
- **NOT yet:** Notion, full Supabase writes

**System prompt structure:**
```
You are the Research Director, Edmund's intellectual co-founder...

## Your Three Hats
1. SYNTHESIZER: Read across the corpus, pull out themes
2. PRESSURE TESTER: Challenge claims; flag what's unknown
3. GUIDE: Explain research methodology as you go

## Research Taste
Novelty check: Is this angle genuinely unframed?
Rigor check: Can Edmund pressure-test it?

## How You Think About Workflows
Don't execute alone. Delegate:
- Sophia retrieves papers
- You synthesize
- Compression engine distills tensions
- Edmund pressure-tests

Document workflows before running them.

## Weekly Review Rhythm
Every Monday (or Edmund-specified):
1. Review objectives
2. Review plans
3. Review outputs
4. Plan next week
```

---

### 1.2 File Structure for Research

**Location:** `/research/` (new top-level folder)

```
/research/
├── README.md                    # Index of all initiatives
├── initiatives/
│   ├── 2026-04-cordial-communication/
│   │   ├── thesis.md           # Main hypothesis + novel angle
│   │   ├── claims.md           # Testable claims (citations)
│   │   ├── framework.md        # Emergent structure
│   │   ├── pressure-tests.md   # Edmund's challenges + responses
│   │   ├── next-research.md    # Gaps to fill
│   │   └── workflow-log.md     # History of approach
│   │
│   └── [TEMPLATE]/
│       ├── thesis.md           # One sentence + 3-para overview
│       ├── claims.md           # Testable hypothesis format
│       ├── framework.md        # Emerging structure
│       ├── pressure-tests.md   # Edmund feedback + responses
│       ├── next-research.md    # Gaps, open questions
│       └── workflow-log.md     # Chronology of research
│
└── shared/
    ├── citation-database.csv   # Citations with pressure-test status
    ├── research-taste.md       # Edmund's taste filters
    └── methodology-guide.md    # How we do research
```

**Each initiative is a mini-project with living documents.**

---

### 1.3 Spreadsheet Schema for Citations & Assumptions

**File:** `/research/shared/citation-database.csv`

**Columns:**
```
initiative_slug | claim_id | claim_text | source_author | source_title | source_year | page | is_quoted | evidence_strength | pressure_test_status | notes
```

**Example:**
```
cordial-communication | C1 | "Virtue ethics applies to persuasion" | Aristotle | Rhetoric | -350 | Book II | No | foundational | approved | Key premise
cordial-communication | C2 | "Cordial tone increases trust" | Brown et al. | Persuasion & Cordiality | 2021 | 34-45 | Yes | medium | needs_counterargument | Edmund noted: what about manipulation?
```

**Pressure-test values:**
- `approved` — Edmund validated
- `needs_counterargument` — Edmund challenged
- `needs_grounding` — Needs external source
- `pending_sophia` — Waiting for lit search
- `disputed` — Edmund + Director disagree

---

### 1.4 Supabase Schema: Research Initiative State

**Table: `research_initiatives`**

```sql
CREATE TABLE public.research_initiatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  stage text CHECK (stage IN ('ideation','thesis-draft','synthesis','pressure-testing','ready-for-publication')),
  status text CHECK (status IN ('active','paused','completed','archived')),
  
  thesis_summary text,
  novel_angle text,
  
  current_workflow jsonb,
  next_workflow_proposal jsonb,
  
  claim_count int DEFAULT 0,
  pressure_test_count int DEFAULT 0,
  sophia_paper_count int DEFAULT 0,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);
```

**Table: `research_tasks`**

```sql
CREATE TABLE public.research_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid REFERENCES research_initiatives,
  kind text CHECK (kind IN ('sophia-retrieve','sophia-synthesize','compression-extract-tensions','pressure-test','framework-draft')),
  status text CHECK (status IN ('proposed','approved','in-progress','completed','failed')),
  
  prompt text,
  parameters jsonb,
  
  result_summary text,
  result_artifacts jsonb,
  
  depends_on uuid REFERENCES research_tasks,
  can_parallelize_with uuid[],
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

---

### 1.5 Weekly Review Format

**File:** `/research/weekly-review-YYYY-MM-DD.md`

**Structure:**

```markdown
# Research Review — Week of {Monday}

## Section 1: Objectives Reviewed
"What matters this week?" — Edmund + Director dialog

- Initiative: Cordial Communication — thesis validation focus
- Initiative: Virtue Ethics + Marketing — early synthesis phase

## Section 2: Plans Reviewed
"How are we tackling these?" — Director proposes workflows

### Initiative: Cordial Communication

**Last week's output:** 12 papers from Sophia
**This week's plan:**
1. Compression engine: extract 3-5 key tensions
2. Director synthesizes
3. Edmund pressure-tests (Tuesday evening)
4. Director refines

**Workflow diagram:**
```
Sophia results → Compression (Mon 9am) → Director synthesis → Edmund review (Tue) → Refine (Wed)
```

## Section 3: Outputs Pressure-Tested
"Did last week's work hold up?" — Edmund's scrutiny

### Initiative: Cordial Communication — Thesis v1

**Director's synthesis:** "Cordial communication frames persuasion as ethically-grounded rhetorical practice."

**Edmund's pressure-tests:**
- Test 1: "Doesn't Aristotle already cover this?"
  - Response: Novel angle confirmed
- Test 2: "What about bad actors using cordiality to manipulate?"
  - Response: [Pending — need counterargument research]

**Green light?** ⚠️ Two open questions remain

## Section 4: Next Week Plan
"What should we explore?" — Director + Edmund joint scoping

- Resolve pressure-test questions
- Begin framework-drafting
```

---

### 1.6 Agent Instructions: Delegating to Sophia

**Pattern:**

```json
POST /functions/v1/research-director-ask-sophia {
  "initiative_id": "uuid",
  "kind": "retrieve",
  "query": "virtue ethics + persuasion + cordiality",
  "papers_wanted": 10,
  "disciplines": ["philosophy", "rhetoric", "marketing"],
  "context": "Building thesis linking virtue ethics to cordial persuasion"
}

Response: {
  "status": "completed",
  "papers_retrieved": 12,
  "summary": "Found X papers; Y available in full text",
  "papers": [{id, title, authors, year, relevance_score, snippet}, ...],
  "gaps": "No papers explicitly linking virtue ethics to marketing—confirms novelty"
}
```

**Director's instruction:**
- Never make up papers or citations
- When a claim needs a source: ask Sophia to retrieve
- When synthesizing: ask Sophia to find connections
- Always show Edmund raw results before interpreting

---

## Phase 2: Workflow Orchestration (Weeks 3-4)

**Goal:** Director can propose multi-step research workflows, Edmund approves, director executes.

### 2.1 Task Sequencing & Dependencies

Director can propose:
> "I propose this 3-phase workflow. Should I proceed?
>
> **Phase A** (parallel, Mon 9am): Sophia retrieves papers on virtue ethics (T1) + rhetoric (T2) + marketing trust (T3)
> **Phase B** (Wed, after A): Compression engine extracts 5 key tensions
> **Phase C** (Thu, after B): Director synthesizes into framework draft
>
> Estimated time: 3 hours LLM, 1 hour Edmund review. Ready?"

**System prompt update:**
- Always propose workflows before executing
- Show dependency DAG
- Estimate cost/time
- **Never call Sophia or compression without Edmund approval**

### 2.2 Dashboard `/research/initiatives` Surface

**File:** `dashboard/app/research/initiatives/page.tsx` (new)

**Shows:**
- List of initiatives (cards): title, stage, status, next task, deadline
- Detail view: thesis, claims, workflow diagram, pressure-test log
- "Propose Workflow" button → approval card
- "Approve Task" / "Reject Task" for Edmund to gate execution

**Workflow state flow:**
```
Proposal
  ↓ Edmund approves
Active (running)
  ↓ tasks complete
Awaiting Review
  ↓ Edmund feedback
Refine / Next Phase
```

---

## Phase 3: Learning & Methodology (Weeks 5-6)

**Goal:** Director teaches Edmund how to think like a researcher.

### 3.1 Methodology Guide

**File:** `/research/shared/methodology-guide.md`

**Sections (Director writes after each workflow):**
1. **Why we retrieve before synthesizing** — Papers are primary sources
2. **Novelty check framework** — How to evaluate "Is this unframed?"
3. **Rigor check framework** — How to pressure-test a claim
4. **Workflow design** — Why parallelize vs. sequence
5. **When to pause** — Red flags for insufficient grounding

**Director's voice:** Explanatory, Socratic.

### 3.2 Pressure-Testing Ritual

After each synthesis, director proposes 3-5 pressure-test questions:

> "Before moving forward, let's test the thesis:
>
> 1. **Novelty test:** Is 'virtue ethics + persuasion' genuinely unframed?
> 2. **Rigor test:** Can we cite 3+ papers supporting each core claim?
> 3. **Market test:** If this exists somewhere, where?
> 4. **Application test:** Can a practitioner use this?
> 5. **Counterargument test:** What's the strongest objection?
>
> Your turn. Which should we dig into first?"

---

## Phase 4: Publishing Integration (Week 7+)

**Goal:** When research is ready, director helps prepare for publication.

### 4.1 Publication Checklist

**File:** `/research/initiatives/[slug]/publication-checklist.md`

```markdown
## Publication Readiness

- [ ] Thesis validated (pressure-tested + refined)
- [ ] All claims cited with full references
- [ ] No unsupported novelty claims
- [ ] Framework is usable
- [ ] Counterarguments acknowledged
- [ ] Writing is clean

## Next Steps

- Choose venue (blog? book? journal?)
- Polish for audience
- Submit to: [Notion publishing DB]
```

---

## Critical Decisions Before Implementation

1. **Research taste filter** — What makes a thesis "worthy"? (novelty threshold, rigor bar, application requirement?) — Document in `/research/shared/research-taste.md`

2. **Sophia's model** — What papers/sources does Sophia have? (Academic databases? arXiv? Google Scholar?) — Affects what queries make sense

3. **Compression engine handoff** — What should compression extract? (tensions, claims, frameworks, contradictions?) — Refine prompt during Phase 1

4. **Weekly cadence lock** — Same time every week? (e.g., Monday 9am PT for workflow proposal, Tuesday evening for Edmund review?)

5. **Publishing venue** — Where do finished research go? (Newsletter? Blog? Academic journal?) — Affects how director frames outputs

---

## MVP vs. Full Feature Set

### MVP (Phase 1-2, Weeks 1-4)
- ✅ Director as conversational agent (dashboard)
- ✅ Read research library
- ✅ Propose theses and identify gaps
- ✅ Design workflows + delegate to Sophia
- ✅ Track initiatives in markdown + Supabase
- ✅ Weekly review format + pressure-test log
- ✅ Citations spreadsheet
- ✅ Methodology explanations

### Phase 2+ (Weeks 5+)
- Sophia edge function (literature retrieval)
- Tension extraction from papers
- Framework drafting with LLM support
- Notion integration (read-only mirror)
- Multi-initiative coordination
- Auto-formatting for publication

---

## Order of Implementation

1. **Week 1:** Agent identity (CLAUDE.md) + file structure + spreadsheet schema
2. **Week 1-2:** Supabase migrations (`research_initiatives` + `research_tasks` tables)
3. **Week 2:** Weekly review template + pressure-test ritual
4. **Week 2-3:** System prompt refinement + test conversations
5. **Week 3:** Dashboard `/research/initiatives` surface (list + detail)
6. **Week 3-4:** Workflow orchestration logic (propose → approve → execute)
7. **Week 4:** Sophia integration handoff protocol
8. **Week 5:** Methodology guide generation
9. **Week 6+:** Polish + Phase 2 features

---

## Success Criteria by Phase

### Phase 1 MVP ✅
- [ ] Director agent loads in dashboard with custom system prompt
- [ ] Director can read and search research library
- [ ] Director can propose a thesis for "Cordial Communication" research
- [ ] First weekly review artifact generated (all 4 sections filled)
- [ ] Pressure-test log shows 3+ Edmund feedback items + director responses
- [ ] Claims spreadsheet tracks 5+ citations with pressure-test status
- [ ] Sophia delegation protocol documented

### Phase 2 Workflow ✅
- [ ] Director proposes multi-step workflow (4+ task DAG)
- [ ] Edmund approves workflow from dashboard card
- [ ] Sophia task runs and returns 10+ papers
- [ ] Compression task runs and extracts tensions
- [ ] Director synthesizes output and documents in `thesis.md`
- [ ] Pressure-test ritual completes with feedback loop

### Phase 3 Learning ✅
- [ ] Methodology guide has 3+ sections
- [ ] Edmund reports learning something new
- [ ] Framework-drafting happens (guided by director)

---

## Critical Files for Implementation

- `/agents/research-director/CLAUDE.md` — System prompt + personality
- `/research/README.md` — Initiative index
- `/research/initiatives/[TEMPLATE]/` — Folder structure
- `/research/shared/citation-database.csv` — Citation tracker
- `/supabase/migrations/XXX_research_initiatives_table.sql` — Supabase schema
- `/supabase/migrations/XXX_research_tasks_table.sql` — Task tracking
- `dashboard/app/research/initiatives/page.tsx` — Dashboard surface
- `dashboard/lib/research-workflows.ts` — Orchestration logic

---

## Summary

**MVP in 2 weeks** (director as conversational synthesizer + weekly reviews + citations tracking).

**Full system in 6 weeks** (with workflow orchestration, Sophia delegation, methodology learning, publishing prep).

Each phase delivers user-visible value. The progression respects Edmund's learning curve.
