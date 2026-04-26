# Dashboard Architecture

**Status:** Reconciled 2026-04-17. The dashboard is the existing app at `/factory/dashboard/` (formerly `local agent dashboard/`) — being migrated from filesystem I/O to Supabase rather than rebuilt.

## Shape

`/factory/dashboard/` — Next.js 16 / React 19 / TypeScript app (~8,400 lines). Currently runs locally, reading from `COWORK_PATH` (iCloud) for agent identities and from disk for sessions / workspace / memory / Slack messages / tasks.

**In progress:** Supabase migration replaces all filesystem I/O so the app can deploy to Vercel. Migration plan: [`/dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md`](../../dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md).

**Why this path:** Code review confirmed the existing codebase is clean and production-quality. Building a net-new app would recreate ~8,400 lines for no gain. The only blocker for production was the filesystem dependency — which the migration removes.

## Filesystem → Supabase migration

What moves from disk to Supabase during the migration:

| Concept | Today (local) | After migration |
|---|---|---|
| Sessions | In-memory + JSON | `factory_sessions` + `factory_events` (already exist) |
| Workspace docs (plans/projects/tasks/scopes) | `data/workspace/*.md` + YAML frontmatter | Supabase rows; body = markdown text; frontmatter = JSONB |
| Per-agent memory (context / decisions / learnings) | `data/memory/{agentId}/*.md` | Supabase rows — 1 per agent × memory-type |
| File browser | Recursive disk scan of `COWORK_PATH` | Supabase Storage bucket listings + rows for metadata |
| Slack-style inter-agent messaging | `lib/slack.ts` (disk-backed) | Supabase table `agent_messages` with `session_id` grouping |
| Task inbox | `lib/task-inbox.ts` (disk-backed) | Supabase table |
| Changelog / activity log | `lib/changelog.ts` | `agent_activity_log` (already exists) |

**Not yet migrated:** Agent identity + system prompts continue to load from `COWORK_PATH/Agent Personalities/` for local dev. Moving agents to Supabase is a future task before full Vercel deployment — see `03-decisions/open-questions.md` Q11 for hosting context.

**Not changing:**
- `lib/anthropic.ts` (streaming chat + tool loop) — same pattern, just swapping file-based tools for Supabase / Pinecone / Notion MCP calls
- UI components and layout — all stay
- Zustand stores — stay

## Three inbox entry points → one pipeline

```
Claude chat         ┐
Dashboard /inbox    ├──► capture() Edge Function ──► Supabase Storage (blob)
Webhook URL         │                               ──► Supabase table row (metadata + pointer)
                    ┘                               ──► pgvector / Pinecone (embedding)
                                                     │
                                                     ▼
                                         Supabase Realtime broadcast
                                                     │
                                                     ▼
                                    Dashboard /inbox updates instantly
                                    (no refresh, no polling)
```

### The Edge Function contract

`capture(input)` accepts:
- Text (paste, prompt, memo)
- URL (gets scraped via Firecrawl)
- File upload (PDF, image, audio, markdown → stored in Supabase Storage)
- Prompt template (tagged for reuse)

For each, it:
1. Writes the raw artifact (blob or text) to Supabase Storage + a row in `inbox_items` (or similar)
2. Generates an embedding (via OpenRouter / OpenAI / hosted)
3. Stores the vector (pgvector or Pinecone depending on Q2)
4. Enriches metadata via LLM (topic tags, type, project, action items)
5. Optionally creates a triage card in Notion Work DB (configurable)

One function, many shapes. One backing store. One retrieval path.

## Entry point wiring

### From Claude chat
- MCP tool `capture` exposed via Supabase Edge Function (remote MCP) or Supabase MCP `execute_sql` + `deploy_edge_function` pattern
- User says "save this" → Claude calls the tool → Realtime update on dashboard
- **Primary capture surface today is the CEO Desk Claude project** (per workflows walkthrough). The tool needs to be callable from that project without friction.

### From the dashboard `/inbox` page
- New page added to the existing app
- Client form POST → same Edge Function
- Shows triage queue with Realtime subscription (instant updates from any surface)

### From webhook URL
- Public Edge Function URL protected by a shared secret
- Consumers: iPhone Shortcuts, email forwarding (via a service like SendGrid parse), Slack slash command, browser bookmarklets
- Same body shape as the form POST

## Realtime bridge

Dashboard pages subscribe to Supabase Realtime channels:
- `inbox_items` — new captures appear live
- `factory_events` — session log streams in
- `agent_messages` — Slack-style inter-agent chat updates live
- `workspace_items` — task/plan/scope changes broadcast

No custom WebSocket layer. Native Supabase.

## Auth

- Service role (server-side only) for the Edge Function writes
- Anon key client-side with RLS policies scoped to Edmund's rows
- Shared secret header on the webhook endpoint
- **Hosting/privacy model is Q11** — Vercel+auth vs. Tailscale self-hosted vs. hybrid. Deferred.

## Hosting cost baseline

- Vercel Hobby: free until traffic/team limits (if option-(a) in Q11)
- Supabase: current project already paid; Edge Functions + Storage included
- If Tailscale-only self-hosted (option-(b)): ~$0, runs on home hardware

## Capture-type refinements (from 2026-04-17 walkthrough)

### Voice memos — first-class path
Edmund is a heavy voice-memo user (iPhone Voice Memos app, Claude chat direct, Rode Wireless Go for 12–30 min dictations). **Never plays memos back — always transcribed immediately.** Implication:

```
voice file  ─►  capture() Edge Function
                │
                ├──►  Supabase Storage (the .m4a / .mp3)
                │
                ├──►  Transcription (Whisper / AssemblyAI / hosted)
                │
                └──►  Treat transcript as text capture downstream
```

Single URL endpoint that takes an audio upload and returns a captured text artifact. Eliminates the current "record → open Voice Memos → open Claude → paste" friction.

### Session retro → promotion (SOPs-as-Skills)
End-of-session Skill that:
1. Summarizes the conversation
2. Identifies connected Skills / SOPs / core docs
3. Suggests promotions: "I can update these N documents based on this session — approve each?"
4. On approval: writes new `skill_versions` row, updates the doc, logs the source session

Cross-document awareness matters. If the conversation touched both content-strategy and voice-tone, the agent proposes updates to *both*.

### Triage inbox Skill
Edmund's existing "sort later" pattern — "ask Claude to go into Notion and help me sort." Formalize as a Skill triggerable from the dashboard or scheduled. Claude tags, enriches, prioritizes, routes to the correct Notion DB, and surfaces questions needing Edmund's attention.

### Home page — progress surfacing
Dashboard home view needs:
- **Goals / progress panel** — high-level objectives with visual progress
- **"What you pushed forward today" card** — auto-generated daily recap from `work_log`
- **Last touched per project** — including last file, last task, last Skill update
- **Streak / momentum indicators** — where applicable, to maintain motivation

All data comes from the thin-schema tables in `01-context/workflows-and-capture.md`.

## What's NOT in v1

- Multi-user access (family, clients, teammates) — RLS + shared-MCP pattern comes later
- Agents stored in Supabase (still loaded from `COWORK_PATH` locally)
- Mobile PWA optimization — ship the web app first, iterate
- Complex triage rules — start with a flat queue, add filters as real usage surfaces needs
- **Hosting/privacy model** — deferred to Q11. Migration assumes Supabase-backed but doesn't presume Vercel specifically; same code runs on a self-hosted target.

## Dependencies on other open questions

- **Q2 (vector strategy)** — determines where embeddings live (pgvector in Supabase vs. Pinecone via SDK)
- **Q7 (multi-agent workflows)** — shapes what the dashboard surfaces beyond the inbox (task approval flows, agent run history, etc.)
- **Q11 (hosting & privacy model)** — determines where the migrated dashboard actually lives (Vercel, Tailscale, hybrid)
- **Workflows-and-capture doc** (`01-context/workflows-and-capture.md`) — shapes the capture function's type-handling and the triage views

## Build order

Two tracks running in parallel:

### Track A — Supabase migration of existing app
See [`/dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md`](../../dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md) for the canonical sequence. Summary:

1. Sessions → `factory_sessions` + `factory_events`
2. Changelog → `agent_activity_log`
3. Task inbox → new Supabase table
4. Workspace docs → Supabase rows
5. Per-agent memory → Supabase rows
6. Slack messaging → `agent_messages`
7. File browser → Supabase Storage listings

### Track B — New capture pipeline
Additive work, not a rewrite of existing features:

1. `capture()` Edge Function with minimum happy path (text + URL)
2. `/inbox` page added to the dashboard with Realtime subscription (MVP)
3. File upload path (Storage + row)
4. Voice memo upload + transcription
5. Webhook URL + secret handling
6. MCP tool `capture` for Claude chat integration
7. Triage Inbox Skill
8. Session-retro-promotion Skill
9. Home page progress-surfacing components

### When to tackle which
- Track A is prerequisite for Vercel deployment. Finish before hosting question (Q11) becomes urgent.
- Track B is additive — can start any time after the `capture()` Edge Function is defined. Track B step 1 doesn't require Track A to be complete.

Recommended: finish Track A through workspace docs (step 4) first, then interleave Track B against the remaining Track A items.
