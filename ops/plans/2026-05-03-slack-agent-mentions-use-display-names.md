# Plan — Use agent display names (not canonical ids) in @-mentions

**Created:** 2026-05-03
**Owner:** Claude Code (autonomous build)
**Verifier:** Codex (sanity-check)
**Repo:** `dashboard/`

---

## Problem

Edmund @-mentions Tokamak as `@tokamak`. Other agents reply with `@ceo`. The mention regex resolves both (`resolveAgentHandle` does id-OR-ilike-name), so the wake plumbing works either way — but the UX shows mixed handles in-channel and Edmund has to keep both forms in his head.

**Why agents do this:** every agent-facing surface today exposes the canonical id (`ceo`, `developer`, ...) instead of the display name (`Tokamak`, `Axel`, ...):

1. `lib/slack.ts:postMessage` trigger → `Sender: ${msg.agent}` and `address @${msg.agent}` use `msg.agent` which is the canonical id.
2. `lib/agent-runner.ts` builds `recentSlack` as `[ts] from=${m.agent} type=...:` — canonical id.
3. `lib/tools.ts:read_slack_channel` returns `{agent: m.agent}` — canonical id.

Agents echo what they see. Fix the surfaces, and they'll write display names.

## Goals

- All agent-facing surfaces show the **display name** (`Tokamak`, `Axel`, `Hild`, ...) for any canonical id we know.
- Agents @-mention by display name (`@Tokamak`) by default.
- Backwards compatible: `@ceo` still resolves correctly (no breakage for in-flight messages); we just stop encouraging it.
- No DB migration. `slack_messages.agent` keeps storing canonical id — that's the durable join key.

## Non-goals

- Renaming canonical ids in the DB.
- Post-processing existing messages to rewrite `@ceo` → `@Tokamak` (history stays as it landed).
- Changing how the UI renders senders (it already shows display names via `agentDisplay()`).

---

## Build steps

### Step 1 — Add a `getAgentDisplayName(canonicalId)` helper with cache

**File:** `dashboard/lib/agents.ts`

Build on the existing `resolveAgentHandle` LRU. Add a parallel positive-only map:

```ts
const displayNameCache = new Map<string, { name: string; expiresAt: number }>();

export async function getAgentDisplayName(canonicalId: string): Promise<string> {
  // Returns the agent's display name, or the canonical id as fallback if
  // lookup fails / agent is missing. Never throws — this is used in hot
  // paths (every wake, every recentSlack render).
}
```

Cache TTL: same 30s as handle cache. On miss, query `agents.name where id=...`. If the agent doesn't exist, return the canonical id unchanged so we degrade gracefully on legacy data.

Also export a small batch variant `getAgentDisplayNames(ids: string[]): Promise<Record<string,string>>` for `recentSlack` so we don't fan out N round-trips per wake.

### Step 2 — Use display name in the wake trigger

**File:** `dashboard/lib/slack.ts:postMessage`

Replace the senderLabel and addressGuidance to use display name:

- `senderLabel`: `await getAgentDisplayName(msg.agent)` (Edmund branch unchanged).
- `addressGuidance` agent branch: `address @${displayName} (the sender)` instead of `@${msg.agent}`.

The literal `Sender:` line still includes both for debuggability, e.g. `Sender: Tokamak (ceo)` — display name first, canonical in parens.

### Step 3 — Use display names in `recentSlack` injection

**File:** `dashboard/lib/agent-runner.ts`

Today: `[ts] from=${m.agent} type=${m.type}: ${content}`.
Change to: batch-fetch display names for the unique agent ids in `msgs`, then render `from=${displayName} type=...` (no canonical id — display name is enough; if an agent shows up unknown, fall back to the canonical id).

### Step 4 — Use display names in `read_slack_channel` tool result

**File:** `dashboard/lib/tools.ts`

The tool returns `{agent: m.agent, ...}`. Enrich each row with `agent: displayName, agentId: m.agent` so the agent reading the channel sees `Tokamak` as the primary handle, with the canonical id available if needed for tool calls (e.g. task assignment).

### Step 5 — Tell agents to mention by display name + provide a small roster

**File:** `dashboard/lib/anthropic.ts:buildSystemPrompt`

In the inter-agent comms section:

- Add: `When you @-mention an agent, use their display name (e.g. @Tokamak, @Axel, @Hild) — not their canonical id (@ceo, @developer, @designer). Both resolve, but display names are the convention and reduce drift.`
- Inject a tiny roster (Name → Role) just below the comms-tools list so the agent has a single reference. Source: query `public.agents where archived=false`. Cache module-level for the lifetime of the request (acceptable staleness — the roster doesn't change often).

### Step 6 — Verification

```bash
# (a) Trigger string uses display name
curl -X POST $BASE/api/slack -d '{"channel":"general","content":"@Tokamak verify display-names","agent":"human"}' \
  -H content-type:application/json
# Inspect the wake row's trigger_message — Sender line should read 'Tokamak (ceo)' or similar.

# (b) Trigger an agent → agent post
# Have a wake fire on tokamak; observe ceo's reply mentions @Axel (or whichever agent), not @developer.

# (c) Backward compat
# @ceo still resolves and queues a wake row (resolveAgentHandle id-match path is unchanged).
```

## Risk + blast radius

- All changes are agent-facing prompt surfaces. No data shape change in `slack_messages` (agent column still stores canonical id). Worst case: prompt injection of display names doesn't take and agents continue to mix — fixable by tightening the system-prompt rule. Low blast radius.
- The roster injection adds ~13 lines to every system prompt. Token cost is small (and behind the `cache_control: ephemeral`).

## Codex sanity-check prompt

```bash
cat ops/plans/2026-05-03-slack-agent-mentions-use-display-names.md | codex exec --skip-git-repo-check \
  "Sanity-check this plan. Concerns: (1) any place where surfacing display names in prompts would BREAK something — e.g. an agent calling a tool that expects canonical id and now passes the display name instead, (2) is the 'Sender: Tokamak (ceo)' format clear or noisy, (3) better than this approach: just rename canonical ids in DB to match display names, (4) should read_slack_channel return display name as 'agent' or as a separate field. Be terse, blockers vs nits."
```

## Push strategy

Commit per step (or bundle Steps 2-4 since they're parallel surface changes), push to `main`, no PR.
