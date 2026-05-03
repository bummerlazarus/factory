# Plan — Edmund-aliases + @-mention badges

**Created:** 2026-05-03
**Owner:** Claude Code (autonomous build)
**Verifier:** Codex (sanity-check, not full review)
**Repo:** `dashboard/`

---

## Problems

1. **Noise from agent → Edmund mentions.** When Tokamak posts `@EdmundMitchell`, my unresolved-mention system reply fires ("⚠️ No agent matches [edmundmitchell]…"). Edmund posts as `human`, so `EdmundMitchell` isn't a registered agent — but it's also not a typo, it's the canonical-but-unmodeled "address Edmund" handle. The warning is noise, and it pollutes the channel.

2. **Sidebar badge counts any new message.** Today `totalUnread()` sums across all channels treating *every* new message as worth surfacing. In a multi-agent room with cross-talk, that's not actionable. The signal Edmund actually wants: "agents are addressing me directly, here's the count."

3. **Tab badges are also undifferentiated.** Same issue — any unread shows up the same as "@you" mentions.

## Goals

- `@EdmundMitchell` (and obvious aliases) from an agent: no system warning, no wake, treated as a valid for-Edmund-to-read mention.
- The sidebar "Comms" badge shows count of *unread agent → human* mentions specifically.
- Tab badges show two distinct signals: an emphatic count for `@you` unreads, and a dim dot for "any unread" if there's also non-mentioning activity.
- No DB migration; no schema changes.

## Non-goals

- Push notifications (browser/native).
- Per-channel mute settings.
- Threading-aware unread counting.

---

## Build steps

### Step 1 — Edmund-alias resolution + suppress system reply

**File:** `dashboard/lib/slack.ts`

Today, `postMessage` calls `resolveAgentHandle(handle)` for each `@mention`. Unresolved → emit a system reply.

Add a small known-aliases set BEFORE the resolver runs:

```ts
// Mentions that mean "the human Edmund." Not registered as agents
// (Edmund posts as `agent='human'`), but agents address him by these
// strings in replies. Treat them as valid sentinels: no wake, no
// system warning, no `unresolvedMentions` entry.
const HUMAN_MENTION_ALIASES = new Set([
  "edmundmitchell",
  "edmund",
  "you",
  "edmundjmitchell",
  "human",
]);
```

Update the resolution loop:

- If `handle.toLowerCase() ∈ HUMAN_MENTION_ALIASES` → skip wake enqueue, skip system reply, skip `unresolvedMentions` entry. (Optionally surface in a returned `humanMentions: string[]` so the badge logic can use it — see Step 3.)
- Otherwise unchanged.

The persisted `slack_messages.mentions` array still records the literal string (`edmundmitchell`); we just stop fanning out wake / warnings.

### Step 2 — Persist a "human mention" signal on the message

**File:** `dashboard/lib/slack.ts` (still in `postMessage`)

We need a way to identify "this message addresses Edmund" later, in the client store, without re-running the alias resolver in JS. Two options:

- (a) Tag a virtual `human` entry into `mentions` when any HUMAN_MENTION_ALIAS is hit. Requires no schema change; SlackMessage.mentions already exists.
- (b) Add a new column. Heavier, defer.

Going with (a). Implementation: when extracting mentions, if any token matches a human alias, ensure `mentions` includes literal `"human"` exactly once (in addition to the original alias strings — keep them for display fidelity). The store's badge logic can then check `msg.mentions.includes("human") && msg.agent !== "human"` for "agent → Edmund."

### Step 3 — Distinct unread counters in the slack store

**File:** `dashboard/stores/slack-store.ts`

Today: `unreadCounts: Record<string, number>` (any new message). Replace with two parallel maps:

```ts
unreadAnyByChannel: Record<string, number>;   // existing behavior, renamed
unreadMentionsByChannel: Record<string, number>; // NEW: agent → human only
```

In `setMessages` / `addMessage`, when computing the "new since last seen" delta:

- Increment `unreadAnyByChannel` for every new message (existing behavior).
- Increment `unreadMentionsByChannel` only when:
  `m.agent !== "human" && m.agent !== "system" && m.mentions.includes("human")`.

`markChannelRead` zeroes both maps for that channel.

Computed: replace `totalUnread()` with `totalUnreadMentions()` (used by the sidebar badge) and keep `totalUnreadAny()` available for tab badges.

### Step 4 — Sidebar button: mention-only badge

**File:** `dashboard/components/slack/slack-button.tsx`

Switch from `totalUnread()` → `totalUnreadMentions()`. The badge becomes the count of agent-direct-to-Edmund pings unread across all channels. If zero, hide.

### Step 5 — Tab badges: two signals

**File:** `dashboard/components/slack/slack-panel.tsx` (the `ChannelTab` component)

Today shows a single `unread` count. Show:

- A primary count badge if `unreadMentionsByChannel[ch] > 0` (uses the existing accent — primary/red).
- Else, if `unreadAnyByChannel[ch] > 0`, a small dim dot (no count) — "activity here, not directed at you."

If both: count wins.

### Step 6 — Verification

```bash
# 1. Edmund-alias suppression
curl -X POST $BASE/api/slack -d '{"channel":"general","content":"@EdmundMitchell test","agent":"tokamak"}' \
  -H 'content-type: application/json'
# Expect: NO system warning; row exists with mentions=['EdmundMitchell','human'].

# 2. Mention badge ticks
# Close the panel. Insert an agent → human message in another channel.
# Open the panel. Sidebar badge should show 1; the channel's tab shows the count badge.
# A bare-noise message (e.g. tokamak: 'investigating' with no @) in the same channel
# should NOT increment the mention badge — only the dim activity dot.

# 3. Mark-read clears
# Click the channel tab; both counts zero out for that channel; sidebar total drops.
```

## Risk + blast radius

- All client-side state + one server-side string change. No DB. No new tables. Worst case: badge counts wrong → fix the predicate in slack-store.
- Adding `"human"` to mentions array is a behavior change for any consumer that reads `mentions` and treats `"human"` literally. `lib/slack.ts:postMessage` already filters mentions to skip `"human"` and `msg.agent` for wake purposes, so it stays safe. `lib/agent-tools.ts` (if it reads mentions) is worth a grep before shipping.

## Codex sanity-check prompt

Plan-level only, before building:

```bash
cat ops/plans/2026-05-03-slack-edmund-aliases-and-mention-badges.md | codex exec --skip-git-repo-check \
  "Sanity-check this plan, not full review. Concerns: (1) does adding 'human' to mentions array break any existing consumer that distinguishes 'human is the SENDER' from 'human is mentioned', (2) is the alias set complete enough — anything obvious missing, (3) any reason to NOT split unreadCounts into two maps, (4) tab-badge UX 'count wins / else dim dot' — better pattern? Be terse, blockers vs nits."
```

## Push strategy

Commit per step, push to `main`. No PR. Brief summary at the end.
