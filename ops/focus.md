# Focus — Next 90 Days

**Drafted:** 2026-05-03 · **Window:** 2026-05-03 → 2026-08-01 · **Status:** draft for Edmund's review

The north-star (`ops/north-star.md`) describes the finished state. This doc names the three things that move the system meaningfully closer to it in the next 90 days. Everything else is "later."

---

## The three

### 1. Dashboard becomes the primary daily surface — laptop first
Today Edmund still opens Claude.ai chat and the Cowork project on his laptop because the dashboard isn't at parity. Three surfaces means three places to keep instructions in sync and three places agent behavior can drift. Goal for the window: **80%+ of Edmund's laptop AI interactions happen in the dashboard.** Claude.ai becomes a backup, not a habit.

**Scope:** laptop only. Mobile (iPhone) is explicitly later — addressing it now drags in privacy/hosting questions (Tailscale vs Vercel) that aren't worth resolving until the laptop story is solid.

**First build:** make the dashboard *always-running* on the laptop — `launchd` (or `pm2`) keeps `npm run dev` alive on login and restarts on crash, so localhost:3000 is always live. Removes the silent killer (forgetting it isn't running) before we touch anything inside the chat.

This is the wedge. Until the dashboard is where Edmund actually lives on the laptop, every other improvement gets diluted across surfaces.

### 2. The capture → promotion loop actually closes
The skeleton from the rebuild MVP — `capture()` → Cordis → end-of-session retro → Corva drafts a promotion → Edmund approves → new `skill_versions` row + git commit — needs to run reliably end-to-end every working day. Today the pieces exist but the loop isn't habitual. Goal for the window: **at least 1 approved promotion per working day, averaged over a week.** That's the proof the flywheel turns at all.

Without this, the rest of the vision (research-director, content engine, expanding team) has no fuel.

### 3. Voice-memo path is first-class
Edmund's highest-bandwidth capture mode is voice (iPhone Voice Memos + Rode dictations). Today voice still requires manual handoff. Goal for the window: **drop a voice memo from anywhere → it lands in `inbox_items` with transcript attached, no manual step.** This is the Lev agent path from the north-star, scoped to just the ingest leg.

This unlocks raw input volume, which is what makes the loop in #2 feel valuable instead of fiddly.

---

## What's explicitly NOT in the next 90 days

- Axel / content engine wiring (waits on #2 producing usable signal).
- Research-director agents and IP map (waits on corpus density).
- Specialist-spawn pattern (waits on volume that justifies it).
- Metrics dashboard for revenue/community KPIs (waits on dashboard being the daily surface).
- Any net-new feature on Claude.ai chat or Cowork that doesn't also exist in the dashboard.

If a request lands that doesn't ladder to one of the three above, the default answer is "not this window."

---

## How we'll know

- **30-day check:** Dashboard is always running on the laptop and open more hours/day than Claude.ai (rough self-report). Promotions queue has items most days. At least one voice memo has flowed through the new path end-to-end.
- **60-day check:** Edmund can go a working day on the laptop without opening Claude.ai. Promotions averaging ~1/day approved. Voice path used weekly.
- **90-day check:** All three goals hit on their stated metric. Decide what the next focus.md says — including whether mobile becomes a Q4 priority.

---

## Changes
- **2026-05-03** — Initial draft. Priority #1 scoped to laptop-only; mobile deferred. First build: always-running dashboard via `launchd`/`pm2`.
