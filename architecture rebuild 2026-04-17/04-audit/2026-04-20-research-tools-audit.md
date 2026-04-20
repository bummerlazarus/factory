# Research Tools & Agents Audit
**Date:** 2026-04-20  
**Focus:** Open-source research direction/synthesis agents, collaborative research orchestration, literature synthesis, and human-in-the-loop research systems

---

## Executive Summary

Searched for open-source tools matching Edmund's profile: research director/synthesis agents for collaborative planning, literature synthesis with project management, human-in-the-loop orchestration, and automated thesis/hypothesis generation from documents. 

**Key finding:** The ecosystem is split between:
1. **Specialized RAG tools** (PaperQA2, OpenScholar) - excellent at literature search/synthesis but not orchestration
2. **Generic multi-agent frameworks** (LangGraph, CrewAI, AutoGen) - orchestration but not domain-specific for research
3. **UI-based platforms** (Elicit, Notion) - research management but proprietary/limited APIs
4. **Open research notebooks** (Open Notebook LM) - privacy-first but still basic collaboration

---

## Top 5 Most Relevant Tools

### 1. **PaperQA2** (Future House)
**GitHub:** https://github.com/Future-House/paper-qa  
**Status:** Open source, active development  

**What it does:**
- High-accuracy RAG agent for scientific paper synthesis
- Iterative query refinement with agentic reasoning
- Citation-grounded responses with sentence-level citations
- Achieves expert-level performance on literature research tasks (beats PhD/PostDoc researchers)

**Strengths:**
- Beats human researchers on literature synthesis quality (tested on LitQA2 benchmark)
- Handles multi-paper synthesis effectively
- Open source with clear implementation
- Can ingest PDFs, papers, markdown, source code

**Gaps for Edmund:**
- No multi-human orchestration (single research director, not team)
- No project/initiative management
- No weekly synthesis reviews/scheduling
- No hypothesis generation from cross-domain documents
- Pure literature focus (academic papers only)

**Best use:** Core literature synthesis engine for research projects

---

### 2. **OpenScholar** (University of Washington / Akari Asai)
**GitHub:** https://github.com/AkariAsai/OpenScholar  
**Paper:** https://www.nature.com/articles/s41586-025-10072-4  
**Status:** Open source, academic research project  

**What it does:**
- Retrieval-augmented synthesis of scientific literature
- Answers queries by searching 45M open-access papers and synthesizing grounded responses
- Available as fine-tuned open weights (Llama 3.1 8B) or with GPT-4o pipeline

**Strengths:**
- Better accuracy than PaperQA2 on multi-paper synthesis (+5.5%)
- Citation accuracy on par with human experts
- Both open-weight (OS-8B) and proprietary models (OS-GPT4o)
- Rigorous evaluation against domain experts

**Gaps for Edmund:**
- Similar to PaperQA2: no orchestration, project mgmt, or team collaboration
- Academic-only (not designed for mixed domain documents)
- No human-in-the-loop checkpoints
- No hypothesis generation

**Best use:** Drop-in replacement for literature synthesis if planning OSS stack; better accuracy than PaperQA2

---

### 3. **LangGraph** (LangChain)
**GitHub:** https://github.com/langchain-ai/langgraph  
**Docs:** https://langchain-ai.github.io/langgraph/  
**Status:** Open source, actively maintained  

**What it does:**
- Graph-based multi-agent orchestration framework
- Explicit control flow (nodes, edges, shared state)
- Built-in human-in-the-loop interrupts and resumption
- Checkpoint/replay for reliability

**Strengths:**
- Designed specifically for multi-agent collaboration
- Excellent human-in-the-loop primitives (interrupt(), resume, approvals)
- State management across agent teams
- Can route to expert agents (divide-and-conquer pattern)
- Works with any LLM and tool ecosystem
- Clear examples for research workflows (planning, research, generation agents)

**Gaps for Edmund:**
- Not domain-specific (no built-in research primitives)
- Requires custom implementation for research workflows
- No project management UI
- No synthesis review scheduling/templates
- No thesis/hypothesis generation logic

**Best use:** Foundation layer for building a custom research orchestration system; pairs well with PaperQA2/OpenScholar

---

### 4. **Open Notebook** (Privacy-first alternative to NotebookLM)
**Site:** https://www.open-notebook.ai/  
**Status:** Open source, newer project  

**What it does:**
- Self-hosted research notebook with multi-modal document ingestion
- Full-text and vector search across documents
- AI-powered chat and analysis with 16+ LLM providers
- Supports PDFs, videos, audio, web pages, Office docs
- Privacy-first (self-hosted, no vendor lock-in)

**Strengths:**
- Designed for collaborative research workflows
- Multi-modal content support (not just papers)
- Data sovereignty and privacy
- Lightweight compared to academic platforms
- Web-based interface
- Extensible (16+ AI providers)

**Gaps for Edmund:**
- No orchestration or agent routing
- No project timeline/milestone management
- No automated thesis/hypothesis generation
- No synthesis review workflow
- Limited to interactive chat (not autonomous agents)
- Newer project (less tested than alternatives)

**Best use:** Research notebook backbone for document organization and basic synthesis; could layer agents on top

---

### 5. **Elicit** (Ought / Public Benefit Corp)
**Site:** https://elicit.com/  
**Status:** Proprietary with public beta features  

**What it does:**
- AI research assistant for literature reviews and evidence synthesis
- Automated screening and data extraction from 125M+ papers
- Generates structured research reports with citations
- Systematic review workflow with human validation
- Table generation for comparative analysis

**Strengths:**
- Industry-leading accuracy (99.4% extraction rate)
- Systematic review automation (human-level quality at scale)
- Screening criteria auto-generation from research question
- Large-scale paper index (125M+)
- 2M+ active researchers
- Human-in-the-loop validation built-in

**Gaps for Edmund:**
- Proprietary SaaS (not open source)
- Limited to academic papers (no mixed domain documents)
- No team orchestration (designed for individual researchers)
- No project management beyond single systematic reviews
- API access limited
- No hypothesis generation

**Best use:** Benchmark for research tool capabilities; consider for specific systematic reviews; not suitable for custom orchestration

---

## Supporting Frameworks (Not Domain-Specific)

### **CrewAI** - https://crewai.com/open-source
Role-based multi-agent orchestration. Good for research teams but no research-specific primitives.

### **Microsoft Agent Framework** - https://github.com/microsoft/agent-framework
Enterprise-grade orchestration (both agentic and workflow modes). Good foundation, steeper learning curve.

### **Temporal** - https://temporal.io/solutions/ai
Durable workflow execution with human approval/intervention. Excellent for long-running research projects.

---

## Gaps in the Ecosystem (Edmund's Needs)

### 1. **Research Project Management**
None of the tools combine:
- Multi-agent orchestration
- Research initiative/project tracking
- Milestone and deadline management
- Weekly synthesis review scheduling
- Team collaboration on research direction

### 2. **Cross-Domain Hypothesis Generation**
PaperQA2, OpenScholar, Elicit all focus on literature synthesis. No tools:
- Generate hypotheses from mixed document types (papers + internal notes + web research)
- Track hypothesis evolution over time
- Compare hypotheses across team members
- Rank/prioritize hypotheses by evidence quality

### 3. **Research Direction/Orchestration**
All tools are either:
- **Passive:** Answer specific questions (PaperQA2, OpenScholar, Elicit)
- **Generic:** Multi-agent without research semantics (LangGraph, CrewAI)

No tool acts as a "research director":
- Propose research questions based on emerging patterns
- Route research tasks to specialist agents
- Synthesize findings into coherent narratives
- Flag contradictions and open questions
- Recommend next research directions

### 4. **Weekly Synthesis & Review Workflow**
No tool has built-in:
- Scheduled review triggers (weekly, monthly)
- Synthesis review templates for team consensus
- Change tracking on conclusions
- Integration with decision logs

---

## Recommendations for Edmund's Stack

### **Immediate (Quick Wins)**
1. **Use PaperQA2 or OpenScholar as literature synthesis core**
   - Both are open source and can be deployed as Supabase Edge Functions
   - OpenScholar preferred if accuracy matters more than speed
   - Create wrapper functions to handle query batching and citation management

2. **Layer LangGraph on top for orchestration**
   - Implement research director agent as a LangGraph subgraph
   - Nodes: [plan_research → route_to_specialists → synthesize → review_findings]
   - Use interrupts for human approval on direction changes
   - Checkpoint state for weekly reviews

3. **Use Open Notebook as research document backbone**
   - Self-hosted, covers PDFs + internal notes + web content
   - Integrate with LangGraph for document access
   - Build synthesis review workflow on top

### **Medium-term (Custom Development)**
1. **Research Direction Agent** (new)
   - Scans weekly research, identifies patterns
   - Proposes new research questions
   - Scores hypotheses by evidence quality
   - Routes to appropriate specialist agents

2. **Synthesis Review Workflow** (new)
   - Triggered on schedule (weekly)
   - Generates team-ready synthesis from research agents
   - Checkpoints for human approval/modification
   - Logs decision changes

3. **Hypothesis Tracking System** (new)
   - Store hypotheses with evidence chains
   - Track evolution over time
   - Cross-domain support (papers + internal + web)
   - Comparison tools for team review

### **Architecture Pattern**
```
[Research Notebook (Open Notebook)]
           ↓
[Document Ingestion Layer]
           ↓
[LangGraph Orchestration]
  ├─ Research Director Agent
  ├─ Literature Synthesis (PaperQA2/OpenScholar)
  ├─ Web Research Agent
  ├─ Internal Notes Integration
  └─ Hypothesis Generation Agent
           ↓
[Human Review & Approval (Interrupts)]
           ↓
[Synthesis Review Workflow (Weekly)]
           ↓
[Decision Log + Hypothesis Tracker]
```

---

## Costs & Implementation Effort

| Tool | Cost | Effort | Fit |
|------|------|--------|-----|
| PaperQA2 | Free (OSS) | Low (wrap) | High (core) |
| OpenScholar | Free (OSS) | Low (wrap) | High (core) |
| LangGraph | Free (OSS) | Medium (custom) | High (foundation) |
| Open Notebook | Free (OSS, self-host) | Medium (deploy) | Medium (backbone) |
| Elicit | $20-500/mo | Low (API) | Medium (reference) |

---

## References
- [PaperQA2 GitHub](https://github.com/Future-House/paper-qa)
- [OpenScholar GitHub](https://github.com/AkariAsai/OpenScholar)
- [OpenScholar Nature Paper](https://www.nature.com/articles/s41586-025-10072-4)
- [LangGraph Docs](https://langchain-ai.github.io/langgraph/)
- [LangGraph Multi-Agent Examples](https://github.com/langchain-ai/langgraph/blob/main/examples/multi_agent/multi-agent-collaboration.ipynb)
- [Open Notebook](https://www.open-notebook.ai/)
- [Elicit](https://elicit.com/)
- [Microsoft Agent Framework](https://github.com/microsoft/agent-framework)
- [Temporal Workflows](https://temporal.io/solutions/ai)
