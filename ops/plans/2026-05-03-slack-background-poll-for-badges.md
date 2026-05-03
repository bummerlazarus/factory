# Plan — Background slack poll so mention badges actually update

**Created:** 2026-05-03
**Repo:** `dashboard/`

## Problem

Edmund: "agents tagged me, no badge on Comms button or channel tabs."

Reading the code, badges are wired correctly — the *polling* doesn't run unless the panel is open AND the user is on the right channel. Specifically:

1. `components/slack/slack-panel.tsx:222`: `if (!panelOpen) return` early-exits the polling effect. Panel closed → store never sees new messages → badge stays 0.
2. Same effect only polls the *active* channel; mentions in other channels never increment their tab badges.
3. `stores/slack-store.ts:setMessages`: `lastSeenTimestamp` is undefined on first poll, so the new-message loop skips entirely. First-ever paint of a channel shows zero unread no matter what the history holds.

## Goals

- Badges update while the panel is closed.
- Badges update across all channels, not just the active one.
- First poll of a channel doesn't dump the entire backlog as "unread."

## Non-goals

- Server-push (Supabase Realtime) — sidestep complexity until needed.
- Per-channel mute / preference UI.

## Build steps

### Step 1 — `SlackBackgroundPoller` component, mounted in root layout

**File:** `dashboard/components/slack/slack-background-poller.tsx` (new)

Mount alongside `WakeQueuePinger` in `app/layout.tsx`. While the dashboard is open:

- Every 20s, fetch `/api/slack?channel=${ch}&limit=50` for each known channel.
- Call `setMessages(ch, data.messages)`.
- **Do not** call `markChannelRead`. The panel's existing in-panel effect handles read-state when the user is actively viewing.
- Single-flight per tick (skip if previous tick still in flight).

Channel list source: `useSlackStore(s => s.channels)`. This is seeded by the panel's `channels=true` fetch — but that only runs when the panel is mounted. Move that seeding into the poller (or the layout) so the channel list is known regardless of panel state.

### Step 2 — Seed `lastSeenTimestamp` on first sight

**File:** `dashboard/stores/slack-store.ts:setMessages`

Today: if `lastSeen` is undefined → 0 new. That's wrong on initial load (we want zero unread, but only because we just learned about the channel — subsequent new messages should count).

Change to: if `lastSeen` is undefined, treat the most-recent existing message's timestamp as the floor (i.e., "everything you've shown me up to now is read"). Increment counts only for messages strictly newer than that. On the very first poll this means zero increments (correct — we don't want to show 50 unread on cold load). On subsequent polls, new messages tick.

### Step 3 — Stop early-exit in panel poll, keep it as the foreground/snappy poll

**File:** `dashboard/components/slack/slack-panel.tsx`

The panel's existing poll stays — it gives faster updates for the active channel and handles `markChannelRead`. No code change strictly required if Step 1 lands; the two coexist (panel updates active channel quickly; background updates everything else slowly).

Optional cleanup: drop the panel's poll entirely, rely on the background poller. Simpler but slower foreground UX. **Defer** unless the parallel polling causes issues.

### Step 4 — Verification

```bash
# (a) Close panel. Have an agent post @EdmundMitchell in #general (curl as ceo).
#     Within ~20s, sidebar Comms badge shows 1.
# (b) Open panel; channel = general. Sidebar badge → 0 (markChannelRead fires
#     when switching to active=general).
# (c) Switch to #engineering. Have an agent post @EdmundMitchell in #general.
#     Sidebar badge shows 1; #general tab shows count chip.
# (d) Cold-load the dashboard. No badge surge from history.
```

## Risk

- Polling 6 channels every 20s = 6 GETs / 20s = 0.3 rps. Trivial.
- If a channel returns 500, swallow + retry next tick; never throw to the React tree.

## Codex sanity-check

```bash
cat ops/plans/2026-05-03-slack-background-poll-for-badges.md | codex exec --skip-git-repo-check \
  "Sanity check, not full review. Concerns: (1) is the lastSeen-on-first-sight semantics right (zero unread on cold load, then increments thereafter), (2) any race between the panel's foreground poll and the background poll that could double-count or miss a message, (3) is 20s the right cadence, (4) better than this approach: just call mutate() / supabase realtime. Be terse, blockers vs nits."
```
