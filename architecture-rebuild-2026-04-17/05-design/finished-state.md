# Finished State — What "Done" Feels Like

**Status:** Vision anchor drafted 2026-04-17. Living doc. This is the target experience the build is aiming at — use it as a verification checklist, not a spec. MVP ships the skeleton (see `decisions-log.md` Q7 MVP); everything below is what the skeleton grows into as the self-improving loops run.

---

## The one-line version

A compounding personal/work AI stack where every capture multiplies, every session improves a Skill, every published piece feeds metrics that steer the next one, and the agent team expands itself around whatever is generating momentum — all pointed at a small set of revenue + community-growth metrics.

---

## 1. Daily experience

### One inbox, many mouths
Dump a thought anywhere — Claude chat on iPhone, the dashboard `/inbox` page, or a Shortcut firing the webhook — it all lands through the same `capture()` Edge Function into Supabase. Text, URLs (Firecrawl-scraped), PDFs/images (Storage), and voice memos (auto-transcribed by Lev) are all first-class.

### Realtime everywhere
Capture on your phone; the dashboard `/inbox` updates instantly — no refresh, no polling. Same for agent activity, task inbox, agent messages, promotions queue.

### The troupe is working quietly
- **Cordis** — capture/chat in CEO Desk.
- **Axel** — content (ideation, drafting, repurposing).
- **Hild** — ops / client (Digital Continent work).
- **Lev** — ingest / transcription (voice, YouTube, PDFs).
- **Corva** — end-of-session retro; drafts Skill promotions.
- **Librarian** — clusters observations; surfaces themes.

They coordinate only through the shared Supabase brain. You don't manage agent chatter.

### Session retro → promotion
At session close, Corva drops a diff into `/inbox/promotions`: *"Based on this session I can update these N docs/Skills — approve each?"* Cross-document aware: if you touched voice-tone and content-strategy, both get proposed. Approved = new `skill_versions` row + git commit in `/skills/`.

### Proactive surfacing
- 9pm Daily Recap: *"You pushed X forward today. N promotions waiting."*
- Home page: high-level goal progress, last-touched per project, last Skill updated, momentum indicators.
- Context nudges: *"You had an idea that nudged ZPM forward — here's where it landed."*

### Notion as ops surface
Work DB, Creator Engine, CEO Desk Sessions, Meetings, Pitches, Swipe Files, Podcast Outreach, People, Organizations, Strategies — all still there, now populated by agents reading from the shared brain.

---

## 2. The research-director layer (pillar 4, in full)

### Self-improving Skills (Hermes-style)
Every Skill in `/skills/<topic>/` carries its own versioned reference set. Ingested content (books, podcasts, client work, your own voice memos) gets scored for relevance against active Skills. High-confidence matches surface as proposed Skill updates; low-confidence matches feed the `observations` table.

Skills get sharper with use. A year from now, `skills/voice-tone/SKILL.md` reads like a master class you didn't have to write.

### Research-director agents
Agents whose entire job is watching the knowledge base and thinking about your IP.

- Monitor new captures + existing corpus for **emergent themes** you haven't named yet.
- Surface **unexpected connections** across silos — a client insight that pairs with a podcast takeaway that pairs with a framework you wrote two years ago.
- Propose **new Skills, frameworks, or IP** when the cluster density justifies it — *"Three sessions + two podcasts + one client engagement are circling the same idea. Want me to draft `skills/<new-framework>/SKILL.md`?"*
- Maintain a living **"IP map"** — what you've authored, what you've hinted at, what the market is asking for, where the gaps are.

World-class research director energy. The system is developing your IP alongside you.

---

## 3. The content engine

### Metrics wired to the pipeline
Every stage of `idea → research → outline → scripting → production → publishing → repurposing` is instrumented. Metrics (views, retention, comments, shares, conversions, list growth, community signups) flow back from every channel (YouTube, Instagram, Beehiiv, podcast, Circle community) into the same Supabase brain and attach to the original content asset.

### Content multiplication
More raw input → more published output. One 25-minute Rode dictation becomes: a long-form article, a newsletter, 3 YouTube hooks, 5 Instagram carousels, 2 podcast outlines, 10 shorts scripts — all drafted by Axel, reviewed by you, scheduled for the right channel.

### Educated bets
Axel tracks what works and doubles down. Patterns:
- **"Double-down queue"** — top-performing hooks/formats get variations auto-drafted.
- **"Educated bets"** — Axel proposes creative new angles with a predicted-performance rationale from prior signal. You approve which ones ship.
- **Surprising hooks / pain points** — the research-director layer flags audience questions and tensions as they repeat in comments, DMs, and community threads.

### Design evolution
The more the system produces, the **more varied and beautiful** the output gets. Templates fork. New visual formats get tried and either retired or added to the house style. Brand system compounds rather than staying static.

---

## 4. The expanding team

The team isn't fixed at six agents. As volume generated by the content engine grows, specialist agents get proposed and spun up:

- *"Volume of client deliverables justifies a Digital Continent ops specialist."*
- *"Podcast outreach is a steady cadence — want a dedicated booking agent?"*
- *"Instagram repurposing is eating Axel's budget — spawn an IG specialist?"*

Spawning a specialist = new system prompt + tool allowlist + memory slot, wired to the shared Supabase brain. You approve the spawn; it joins the troupe. Retire it the same way.

It feels like **working with a team that keeps growing around the work that's generating momentum**.

---

## 5. The metrics alignment

Every agent — and you — are pointed at a small set of metrics that drive revenue and community growth. The exact set is TBD, but the shape:

- **Revenue metrics** — DC client retainers, Cordial Catholics monetization, ZPM subscriptions, product launches.
- **Community metrics** — Cordial Catholics subs + engagement, Circle community growth (ZPM / EM / Real+True), newsletter list growth, inbound DMs/leads.
- **Leading indicators** — content velocity, publish cadence, promotion approval rate, Skill-update frequency, ingest-to-publish time.

Dashboard home shows these prominently. Every agent's work ties back to which metric it moved. Weekly: *"This week, Axel's Instagram repurpose lifted community signup rate by X%. Continuing."*

---

## 6. The compounding flywheel

```
More raw capture
        │
        ▼
More transcripts / structured data
        │
        ▼
More observations + Skill updates
        │
        ▼
Sharper Skills → better drafts → more published variations
        │
        ▼
More metric signal per channel
        │
        ▼
Sharper educated bets → more winners
        │
        ▼
More revenue / community → more time for capture
        │
        ▼  (loop)
```

Every turn tightens the loop. The system gets **smarter and more productive with use, not just busier.** Exponential isn't a slogan here — it's what a working flywheel looks like.

---

## 7. What's gone

- GravityClaw / Railway — decommissioned.
- Pinecone — retired after dual-read window; pgvector is the one vector store.
- Filesystem dependency in the dashboard — gone; runs on Vercel.
- "Which version of my voice-tone doc is current?" — one source of truth now.
- Custom MCP maintenance tax — replaced by native MCPs.
- "Where does this go?" friction — one capture pipeline, many entry points.
- Manual content repurposing — Axel + repurposing specialists handle first draft.
- Blind publishing — every piece ships with a metric hypothesis and gets measured.

---

## 8. Verification — how you know it's running

### Smoke test (5 minutes)
1. Voice memo from iPhone → Shortcut → row in `inbox_items`, transcript attached, dashboard `/inbox` updates live.
2. Paste a URL in Claude chat → Firecrawl scrapes, vector lands in `memory`, searchable via `match_memory()`.
3. Close a CEO Desk session → promotion draft appears in `/inbox/promotions` with concrete diff.
4. 9pm → Daily Recap arrives referencing today's `work_log`.

### Weekly tells
- Promotions queue has items you didn't ask for.
- Research-director agent has surfaced ≥1 connection across silos this week.
- At least one content piece published via the Axel pipeline with attached metric hypothesis.
- Metrics dashboard shows channel numbers updating automatically (no manual spreadsheet).
- `skill_versions` has ≥1 new row from approved promotions.

### Monthly tells
- At least one new specialist agent spawned (or a proposal evaluated and declined).
- A new Skill or framework drafted by a research-director agent from cluster density.
- Content velocity up vs. prior month without proportional time investment from you.
- A "surprising hook" flagged by the research layer has shipped and gotten measured.

### Quarterly tells
- Revenue and community metrics on the dashboard show directional lift tied to Axel/Hild work.
- The `skills/` git log reads like a growing body of IP — not scattered notes.
- You can answer *"what did the system push forward this quarter that I didn't directly drive?"* with specifics.
- Pinecone invoice is $0. Railway invoice is $0. Vercel + Supabase are the only ongoing infra lines.

### The "is it alive" tell
After a week away, you open the dashboard and see work you didn't explicitly request — promotions waiting, daily recaps queued, signals ingested, a research-director note about a pattern it's watching, a specialist-spawn proposal. The system does work while you're not looking. Pillar 5 working.

---

## 9. Relationship to MVP

What ships first (Q7 MVP in `decisions-log.md`) = **the skeleton**:
- Cordis + Corva + `/inbox/promotions` + Daily Recap + `capture()` for text/URL.

Everything in this doc beyond that is what the skeleton **grows into** as captures accumulate, Skills version up, and the content engine gets wired to metrics. The order of growth:

1. **Skeleton lives** — MVP captures flowing, promotions approving, Daily Recap arriving.
2. **Voice-memo path** — Lev added; transcription on every capture surface.
3. **Content pipeline** — Axel + metrics wiring per channel.
4. **Research-director layer** — a Skill that runs across the corpus weekly, proposes new Skills and cross-silo connections.
5. **Specialist-spawn pattern** — documented + first specialist evaluated.
6. **Metrics-driven publishing** — educated-bet queue + double-down automation.
7. **Expanding team visible** — ≥3 specialists beyond the core six, all earning their spot.

Each step unlocks the next. None of them require a rewrite.

---

## Changes

- **2026-04-17** — Initial draft. Combines daily-experience summary + Edmund's expanded vision (Hermes-style self-improving Skills, research-director agents, content-engine metrics loop, expanding team, exponential flywheel, metric alignment).
