# Memory Layer Design

**Status:** Drafted 2026-04-17. Blocks Phase 3 of [migration-plan.md](migration-plan.md). Inherits policy from `decisions-log.md` entry "Memory provider policy: one primary + one plugin slot".

## Purpose

One named interface for all agent memory reads and writes. Sits between Phase 2 (native MCP collapse) and Phase 3 (`capture()` Edge Function). Every write path — capture, agent mid-session, session-retro — goes through this interface. Raw SQL into memory tables from Edge Functions is out of bounds.

## Provider policy (recap)

- **Primary provider:** Supabase MCP on the tables listed below. Always on.
- **Plugin slot:** exactly one external vector provider at a time. Backend is Q2-resolved (live contest: integrated Pinecone / BYO Pinecone-via-SDK / pgvector).
- **Second plugin** = explicit decisions-log exception, not drift.
- **"Primary" = one provider, not one table.** Many tables under Supabase MCP; the constraint is on tool-schema surface area exposed to the model.

## Typed slots

| Slot | Table | Scope | Main writer | Read path |
|---|---|---|---|---|
| `facts` | `agent_core_memory` | per-agent + shared | `capture()`, agent skills | snapshot injection, MCP query |
| `conversations` | `agent_messages` (+ `session_id`) | per-session | agent runtime | recent-messages lookups |
| `observations` | `observations` *(new)* | per-agent, per-session | agent mid-session | session-retro skill |
| `skill_versions` | `skill_versions` *(new)* | global | approval gate (Edmund or retro skill) | skill load |
| `per_agent_memory` | `agent_memory_{type}` rows | per-agent × type (context / decisions / learnings) | dashboard migration, agent skills | per-agent snapshot |

Sessions / work_log / token logs (thin-schema gaps from pillar 1) are memory-adjacent but operational; they live alongside the memory tables but are not memory slots — no snapshot duty.

## Frozen-snapshot pattern

Lifted from Hermes `tools/memory_tool.py:105-140` (see [`04-audit/2026-04-17-hermes-agent-review.md`](../04-audit/2026-04-17-hermes-agent-review.md) §3.1).

- **Session start:** compose the snapshot from current primary state + reference docs, inject into system prompt.
- **Mid-session writes:** land on live rows immediately (durable). **Do not mutate the snapshot.**
- **Next session start:** fresh snapshot.

Keeps the prefix cache stable across a session. A mid-turn write does not invalidate the cached prompt prefix.

## Multi-agent snapshot scope

**Each agent gets its own snapshot at its own session start.** Decided 2026-04-17.

- Axel/Corva/Hild/Lev/Cordis each have independent session boundaries and independent snapshots.
- A snapshot composes: shared facts + that agent's per-agent memory + reference docs + recent-conversations excerpt.
- Cross-agent propagation is **explicit and lagged**: if Axel's session writes a fact Corva should see, Corva sees it on Corva's *next* session start. No live cross-agent fanout during a session.
- Shared facts (global goals, personal profile) live at the `facts` level with no agent scope; they're included in every agent's snapshot.

This matches how Edmund works already (one agent at a time, per surface) and avoids the complexity of keeping N concurrent agent snapshots coherent mid-session.

## Reference docs — NOT a memory slot

Pillar 2 proposes `reference_docs` for goals/values/KPIs/frameworks (see [`01-context/vision-and-priorities.md`](../01-context/vision-and-priorities.md)). These are **published facts, not accumulated memory** — they have authors, versions, and approval gates. They live as a **separate read-only reference layer**, not a memory slot.

- Reference docs are injected into every snapshot (all agents, all sessions).
- They only change on Edmund-approved edits (session-retro promotion, direct edit, `reference_docs` upsert tool).
- An agent writing an observation about a goal does **not** mutate the goal — mutation requires promotion with approval.

Separating published facts from inferred memory means the canonical goal statement doesn't drift across agents.

## Plugin slot contract

The vector plugin exposes exactly these operations to the model:

- `search_memory(query, namespace?, filters?)` — semantic + metadata filter. Single tool schema regardless of backend.
- `upsert_memory(records)` — called only by `capture()` and approved promotion skills. Not a per-turn model tool.

Namespace convention is **backend-agnostic** (e.g., `facts`, `conversations`, `knowledge`, `signals`). Switching plugins = re-point the adapter, not reschema the tools.

## Write-path guardrails

All writes (primary and plugin) pass through `scanContent(content, metadata)` before persistence. Port the pattern list from Hermes `tools/memory_tool.py:65-102`:

- Prompt-injection strings (`ignore previous instructions`, `you are now`, `system:` role injection)
- Invisible Unicode (zero-width chars, bidi overrides)
- Exfiltration primitives (`curl $KEY`, `cat .env`, base64 blobs of secret shape)
- Oversize payloads (fail cheap)

Especially relevant for URL-scraped captures via Firecrawl. On detection: drop the write, log to activity log, surface in dashboard.

## Interface shape (proposed)

Single shared module — `supabase/functions/_shared/memory.ts`. Named accessors per slot. Draft signatures (to be refined when `capture()` gets built):

```ts
// Writes (all route through scanContent first)
writeFact(agentId | null, content, source)            -> { id }
writeConversation(sessionId, agentId, role, content)  -> { id }
writeObservation(agentId, sessionId, content, score)  -> { id }
proposeSkillUpdate(skillId, diff, sourceSessionId)    -> { version_id, pending_approval: true }
upsertReferenceDoc(slug, content, approvedBy)         -> { id, version }

// Reads
buildSnapshot(agentId, sessionId) -> {
  sharedFacts, perAgentMemory, referenceDocs, recentConversations
}
searchMemory(query, { agentId?, namespace?, filters? }) -> results[]
getRecentConversations(agentId, limit) -> conversations[]
```

`capture()` calls `writeFact` / `writeConversation` / `upsert_memory` (plugin). No direct SQL into memory tables.

## Questions resolved inline

- **Primary = one provider, not one table.** Many tables under Supabase MCP.
- **Reference docs are not memory.** Separate read-only layer, Edmund-approval invalidation.
- **Multi-agent snapshot scope.** Each agent has its own snapshot; cross-agent reads happen at next session start.
- **Pinecone + pgvector can't coexist as live plugins.** Q2 resolution = a cutover, not dual-write.

## Open (fold into Q2 when decided)

- Embedding dimension (1536 vs 3072)
- Sync vs async plugin upsert in `capture()` — block on plugin write, or return after primary + enqueue the vector write?
- Corpus re-embedding strategy if Q2 resolves to pgvector (~14,491 vectors, one-time, scriptable)

## Deliverables before Phase 3

- [ ] Migrations for `observations` and `skill_versions` tables + indexes
- [ ] `scanContent()` implementation with Hermes pattern list ported
- [ ] `supabase/functions/_shared/memory.ts` interface skeleton
- [ ] `buildSnapshot(agentId, sessionId)` implementation
- [ ] Plugin slot adapter interface (abstract — Q2 resolution plugs in without touching callers)
- [ ] Add `reference_docs` table (separate from memory slots) + upsert Edge Function
