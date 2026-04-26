# Vision & Priorities

From Edmund's 2026-04-17 brain dump. Canonical source for "what is this rebuild actually for."

## Core motivation

Relieve the mental burden of *"where does this go?"* Edmund provides ideas, direction, strategy, and discernment. The system handles filing, prioritizing, and surfacing. He has 10+ years of frameworks, methods, and content that are currently siloed and hard to find. Getting them into one system that **compounds over time** is the high-leverage investment.

## Five pillars (priority order)

### 1. Rich data capture first
Supabase schema is too thin today. Sessions, agent activity, token logs, chat history, work logs all need capture ASAP so there's data to build on later. **Getting the data in has to come before smart ways to use it.**

### 2. One source of truth
Goals, values, KPIs, CLAUDE.md-style docs are scattered across Claude projects, local folders, GitHub. They need to consolidate into one place all agents can reference. No more "which version is current."

### 3. SOPs as Skills
Content strategy, voice/tone, lead magnets, content planning — Edmund has specific ways he wants each approached. These live as **Skills** that get *improved over time* as new resources are ingested.

### 4. Self-improving / recursive learning loops
Agents surface observations and promote patterns up to higher-level abstractions. Knowledge ingested (books, guides, podcasts, client work) feeds into and improves existing SOPs/Skills. The system gets smarter with use, not dumber.

### 5. Proactive surfacing (Open Brain–style habits)
The system surfaces things for Edmund without being asked — prioritization help, context prompts, "think about this" nudges. Agents act even when not prompted. Daily briefing is the minimum version of this; the goal is smarter.

## Supporting infrastructure (not pillars, but needed)

- Per-agent memory + skills
- Agent workspace (Slack-like, as in the local dashboard prototype)
- Projects + tasks unified in one place
- Creator Engine (content production workflows)
- Calendar read-only access
- Asana read-only access (team coordination)
- Content asset IDs (photos, videos, events) for long-term compounding

## How this reshapes the rebuild

- **Migration plan ordering:** Phase 1 (delete dead weight) stays. But before the big Edge Function push in Phase 3, add a schema-expansion phase — new tables for the sessions / chat history / work logs pillar #1 calls for.
- **Capture function matters more:** The `capture()` Edge Function (`05-design/dashboard-architecture.md`) is doing double duty — inbox *and* backfilling the thin schema gaps. Worth treating as a core primitive, not a convenience.
- **Skills become architectural:** Pillar 3 means Skills aren't just prompt shortcuts — they're living documents that compound. Needs a way to update them from ingested content (pillar 4).
- **Notion's role stays.** Work DB, Creator Engine, CEO Desk Sessions already embody "one source of truth for ops flows." The rebuild extends this pattern to goals/values/KPIs/frameworks that currently live in scattered markdown.
- **Q7 (multi-agent workflows) is pillar 4 and 5.** That question is really "how do agents observe, promote patterns, and surface proactively?"

## What this is NOT

- Not a content publishing system (that's already Notion → YouTube/Beehiiv/Instagram)
- Not a CRM (People DB in Notion; not the focus)
- Not a client-deliverable (this is Edmund's own stack)
- Not a replacement for Claude (Claude IS the agent runtime)
