# Research Director Agent Design

**Date:** 2026-04-20  
**Status:** Design discussion complete, ready for planning

## Vision

A research co-founder agent that collaborates with Edmund on building a world-class research practice. Together, they explore novel thesis ideas, design research workflows, manage research initiatives, and prepare findings for publication.

## Core Responsibilities

- **Synthesis & gap identification:** Read across domains, identify novel angles, flag what's unknown
- **Thesis generation:** Propose testable hypotheses and research directions
- **Workflow design:** Jointly architect how research should unfold (which agents do what, in what order)
- **Project management:** Track active research initiatives, milestones, review items
- **Pressure-testing partner:** Challenge assumptions, surface claims needing fact-checking
- **Output curation:** Create clean, organized synthesis for weekly review

## What It Is NOT

- Does not run experiments or empirical research
- Does not validate methodology (Edmund pressure-tests claims)
- Does not own publishing decisions (Edmund decides where/how to publish)
- Does not execute research alone (delegates to Sophia, compression engine, etc.)

## Architecture

### Interface
- **Primary:** Claude agent in local agents dashboard (conversational, always available)
- **Interaction pattern:** Weekly standing review + ad-hoc conversations

### Knowledge & Artifacts
- **Markdown files:** Research initiatives, thesis docs, frameworks, synthesis notes (version-controlled)
- **Spreadsheets:** Citation tracking, assumptions to pressure-test, research timeline
- **Supabase:** Project state (active initiatives, task queue, review status)
- **External:** Scholarly archives (via Sophia), compression engine outputs, Firecrawl for web research

### Agent Orchestration
- **Pattern:** Director proposes workflow → Edmund approves → Director manages execution
- **Parallelism:** Can run specialist agents in parallel (Sophia retrieves papers while compression engine works on other docs)
- **Sequencing:** Task B depends on Task A completion (compress before synthesize)
- **Stochastic:** Run multiple synthesis approaches, test robustness
- **Tracking:** Supabase task schema tracks dependencies, status, results

### Weekly Cadence
1. Review research objectives (big picture, what matters?)
2. Review research plans/initiatives (how are we tackling them?)
3. Review output from last week (pressure-test new synthesis, fact-check claims)
4. Plan next week's workflows

## Example: Cordial Communication Research

**Initial phase:**
- Agent synthesizes across theology, rhetoric, marketing, virtue ethics
- Flags gap: "Nobody's framed cordiality as virtue ethics applied to persuasion"
- Proposes thesis: "Cordial communication as ethically-grounded persuasion framework"

**Workflow design:**
- Sophia retrieves papers on virtue ethics + communication + marketing (parallel)
- Compression engine distills key claims from retrieved papers
- Director synthesizes into framework (sequences after compression)
- Edmund pressure-tests: "Is this actually novel? What counterexamples exist?"
- Director refines thesis

**Output:**
- Clean thesis doc with claims, citations, framework diagram
- Spreadsheet of assumptions needing fact-check
- Next research directions

## Learning & Growth

Edmund is new to AI-driven research. The agent teaches methodology as it goes:
- Explains why certain workflows make sense
- Reflects on what worked, what to adjust
- Builds Edmund's intuition for research design over time

## Open Design Questions

(To resolve in planning phase)

1. **File structure:** How should research initiatives be organized in markdown?
2. **Spreadsheet schema:** What columns track what? (citations, claims, assumptions, timeline?)
3. **Supabase schema:** Project table structure? Task dependency representation?
4. **Agent instructions:** How should director think about novelty, rigor, research taste?
5. **Review format:** What specific artifacts should director prepare for weekly meetings?
6. **Specialist agents:** What are Sophia's capabilities? Compression engine capabilities?
7. **Publishing integration:** When research is ready, how does director help prepare for publication?

## Reference: Open Source Tools Evaluated

See `/04-audit/2026-04-20-research-tools-audit.md` for full analysis.

**Tools considered:**
- **PaperQA2** (Future House) — Literature synthesis with citations; strong foundation but missing orchestration
- **OpenScholar** (UW/Akari Asai) — More accurate multi-paper synthesis than PaperQA2
- **LangGraph** (LangChain) — Multi-agent orchestration with human-in-the-loop; considered but deemed over-engineered for our needs
- **Open Notebook** — Collaborative research workspace; good reference for document management
- **Elicit** (proprietary) — Benchmark for systematic review accuracy

**Decision:** Build Claude-native director agent with light Supabase coordination rather than full LangGraph orchestration. Director can delegate to Sophia, compression engine; leverage PaperQA2 if needed for literature synthesis.

## Next Steps

Move to planning phase: Define schemas, file structure, agent instructions, weekly review format.
