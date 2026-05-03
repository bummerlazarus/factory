# Plan — Slack panel readability + agent reply-attribution

**Created:** 2026-05-03
**Owner:** Claude Code (autonomous build)
**Verifier:** Codex
**Repo:** `dashboard/`

---

## Problems (observed)

1. **Slack panel text spans the entire dashboard width.** The bottom-docked panel is `fixed bottom-0 left-0 right-0`, so on wide monitors a paragraph of agent output stretches across ~1800px of screen — unreadable line lengths (research-backed: comfortable reading is ~50–75 ch / ~600–700px). Visible at [components/slack/slack-panel.tsx:327](dashboard/components/slack/slack-panel.tsx) and the message body at [components/slack/slack-panel.tsx:60-78](dashboard/components/slack/slack-panel.tsx).

2. **Agents misattribute messages.** Hild replied "Perfect, thanks @EdmundMitchell" to a message Tokamak posted. Two contributing causes (confirmed by reading [lib/anthropic.ts:90-130](dashboard/lib/anthropic.ts) + [lib/slack.ts:104-110](dashboard/lib/slack.ts) + [lib/agent-runner.ts:159-167](dashboard/lib/agent-runner.ts)):
   - The trigger user-message says "by tokamak" but the system prompt (especially the inter-agent comm section) names Edmund repeatedly. Agents default to Edmund as the assumed addressee when responding.
   - The recent-slack injection format is `[ts] ${agent}: ${content}` — correct but flat. Nothing tells the agent *who they are replying to right now*.
   - There is no explicit rule "address the actual sender by their handle; do not address Edmund unless he is the sender or @-mentioned."

## Goals

- Slack messages stay within a comfortable reading width on any screen size.
- Channel tabs / header / input row remain full-width (using the panel chrome doesn't cost anything).
- Agents reply to the actual sender by their canonical handle.
- Behavior is observable: a quick check of recent #general should show no rogue `@EdmundMitchell` when the trigger was another agent.

## Non-goals

- Re-architecting the slack panel into a side rail (would change layout state across other features).
- Renaming `human` to `edmund` everywhere (existing data uses `human`; not worth a migration here).
- Per-agent "voice" tuning beyond the address rule.

---

## Build steps

### Step 1 — Cap message body width

**File:** `dashboard/components/slack/slack-panel.tsx`

The panel itself stays full-width (header, tabs, input use it well). What we cap is the **content column**: messages and the day-divider row. Wrap the messages list in a centered container with `max-w-3xl mx-auto` (~768px → ~70ch with current font/leading). Same wrap for the input row's content so the `Send` button doesn't drift to the far right.

Also: ensure the `prose max-w-none` on the message body is replaced with a constraint that lets the *outer* wrapper own width. (Currently `prose-sm max-w-none` defeats prose's default width cap; we want our outer cap to take effect.)

Concretely:
- Wrap each `groupedMessages.map(group => ...)` (and the empty/loading states) inside `<div className="mx-auto max-w-3xl">`.
- Keep `MessageBubble` unchanged; the cap comes from the parent.
- Wrap the input row's flex container similarly.

**Verify:** at viewport width 1920px, message text wraps at ~768px and is centered; at <768px width, no horizontal scroll, panel still usable.

### Step 2 — Make the trigger user-message specify reply target

**File:** `dashboard/lib/slack.ts:postMessage`

The current trigger reads:
> You were mentioned in #${channel} by ${msg.agent}: "${msg.content}"

Replace with a clearer, sender-pinned format:
> **You were @-mentioned in #${channel}.**
> Sender: `${msg.agent}` (their handle — address them as `@${msg.agent}`, NOT as @EdmundMitchell, unless Edmund himself is also mentioned).
> Their message: "${msg.content}"
>
> Read the recent messages in #${channel} for full context, then reply addressing the sender by their handle.

This is a tiny copy change with a strong outcome. Also: when `msg.agent === "human"`, label the sender as `Edmund (human)` so agents have a single explicit shorthand.

### Step 3 — Add an address-the-sender rule to the system prompt

**File:** `dashboard/lib/anthropic.ts:buildSystemPrompt`

In the Inter-Agent Communication section (around line 90), add one bullet:

> - **Address the actual sender.** When you reply to a message, address the agent who sent it by their handle (e.g. `@tokamak`). Only address `@EdmundMitchell` when Edmund himself sent the message or is explicitly @-mentioned. Misattributing messages to Edmund causes confusion and drift.

Also: when injecting `recentSlack`, prefix the line with the explicit "from:" word so it reads as data, not narration:
- Current: `[2026-05-03T17:30] tokamak: ...`
- New:     `[2026-05-03T17:30] from=tokamak: ...`

This is a tiny disambiguation but reinforces who the sender is.

### Step 4 — Verification

```bash
# 1. Width check (visual): open dashboard, confirm messages cap around 768px on a wide monitor.
# 2. Attribution check: post @cordis from another agent (e.g. via lib/tools.ts post_slack_message
#    or by manually inserting a slack_messages row with agent='tokamak' content='@cordis hello'),
#    wait for cordis to reply, confirm cordis addresses @tokamak (not @EdmundMitchell).
# 3. Negative: post @cordis as human, confirm cordis still addresses @EdmundMitchell when Edmund pings.
```

### Step 5 — Commit + push

Commit per step. After all steps pass, run Codex review. Push to `main`. No PR.

## Risk + blast radius

- Width change is CSS-only; no runtime risk. Worst case: looks worse on a narrow viewport — fixable in a follow-up.
- Trigger / system-prompt change affects every future autonomous run. Worst case: agents over-correct and address senders awkwardly. The added rule is permissive ("address the sender") not prescriptive about phrasing, so blowback should be minor. Reversible by reverting the commit.

## Codex review prompt

```bash
git diff origin/main...HEAD -- dashboard/ | codex exec --skip-git-repo-check \
  "Review this change. Look for: (1) layout regressions on small viewports, (2) places where the new sender-handle rule could backfire (e.g. a system message has agent='system' — agents shouldn't address @system), (3) the recent-slack format change breaking any consumer that parses the line. Report blockers vs. nits."
```

---

## Ready-to-paste autonomous-execution prompt

> Execute the plan at `ops/plans/2026-05-03-slack-readability-and-attribution.md`. Commit per step. After Step 4 passes, run the Codex review prompt at the end, integrate any blocker feedback, then push to main. No PR. Brief summary at the end.
