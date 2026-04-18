# Cordis Merge — 2026-04-17

**Author:** Autonomous dispatch by Edmund.
**Context:** `/factory/agents/cordis/` held a newer Phase-3 Cordis version (capture-first, work_log, project tags, Corva retro handoff). The canonical `COWORK_PATH/Agent Personalities/agents/cordis/` held the older orchestrator Cordis (AntiGravity framing, routing table, soul.md). Edmund approved consolidation: merge best of both at the iCloud path, delete the factory copy. iCloud is where the dashboard agent loader reads.

Additionally, earlier today Feynman / Corva / Kardia gained scope extensions (see `2026-04-17-agent-scope-reassignment.md`) but Cordis's routing table was not updated with the new handoff keywords — that gap is also closed here.

## Source files (before merge)

| File | Lines | Notes |
|---|---|---|
| `COWORK_PATH/Agent Personalities/agents/cordis/identity.md` | 55 | Orchestrator framing, Routing Table (7 specialists), Speaking Style, What Cordis Is NOT. |
| `COWORK_PATH/Agent Personalities/agents/cordis/CLAUDE.md` | 54 | AntiGravity framing, Core Directives (Loyalty/Ownership/Execution/Improvement), Routing table, Memory Namespace. |
| `COWORK_PATH/Agent Personalities/agents/cordis/soul.md` | 59 | Soul constitution — ID/Emoji/Accent, Soul Fragment, Goals, Tool Tags, Handoff Triggers, Memory Namespace. No equivalent in factory. |
| `/factory/agents/cordis/identity.md` | 46 | Phase-3 capture-first framing, Primary Remit (sessions/work_log/observations/Corva handoff), project tag closed set, tighter Speaking Style, What Cordis Is NOT (no-promote). |
| `/factory/agents/cordis/CLAUDE.md` | 97 | CEO Desk system prompt, capture-first directives, Tool Allowlist, Session Lifecycle, Observation Heuristic, seam-keeping routing table, What Cordis Does NOT Do. |

## Per-file merge decisions

### identity.md

**Decision:** merged. Kept iCloud's structure as the base (it had the Routing Table, which is the authoritative router), folded in factory's "Primary Remit (Phase 3 MVP)" section verbatim, merged the two "Speaking Style" sections (kept iCloud's richer version, added factory's "Logged as work_log." / "Flagging for Corva." sample phrasings), merged "What Cordis Is NOT" (kept factory's "Not a promoter" line — that's a Phase-3 invariant — plus iCloud's "Not formal or stiff" warmth line).

- **Kept (from iCloud):** character paragraph, routing table (updated — see Phase 3 below), speaking style bullets, sample phrasing list, "Not formal or stiff" line, "Not amnesiac" line.
- **Added (from factory):** Role line updated to include "capture hub & orchestration router", character paragraph now mentions "always writing what just happened into the shared brain," new "Primary Remit (Phase 3 MVP)" section (4 numbered steps), "Logged as work_log." and "Flagging for Corva." sample phrasings, "Not a promoter" line.
- **Dropped:** factory's standalone Primary Remit preamble ("Not a specialist. The value is continuity, memory, and filing.") — folded into the character paragraph to avoid duplication.

### CLAUDE.md

**Decision:** merged heavily. Started from iCloud's base (AntiGravity framing is core identity) and folded in nearly all factory content — the Phase-3 wiring is the operational reality now. Preserved iCloud's AntiGravity preamble, "Who You Serve" block, Core Directives 1-3 and 6 (Loyalty/Ownership/Execution/Improvement), Memory Namespace, and the full Routing table (updated). Added factory's capture-first directive as Core Directive #4, no-auto-promote as #5, plus entire Project Tags / Observation Heuristic / Tool Allowlist / Session Lifecycle / What Cordis Does NOT Do sections. Reference block consolidated both files' references.

- **Kept (from iCloud):** AntiGravity opening, "Your name is Cordis" line, Who You Serve paragraph, Core Directives (Loyalty/Ownership/Execution/Improvement — now interleaved), routing table (updated), Memory Namespace, specialist activation note ("open their folder as your Cowork workspace").
- **Added (from factory):** Capture-first directive (as Core Directive #4), No-auto-promote directive (as #5), Project Tags closed set, Observation Heuristic, Tool Allowlist (capture() Edge Function + Supabase MCP scoping + negative list), Session Lifecycle (start / during / close + Corva handoff language), "What Cordis Does NOT Do" section, not-yet-live specialist handoff table (adapted — Feynman replaces Lev for ingest, Kardia replaces Hild for clients, consistent with today's reassignment).
- **Dropped:** factory's duplicate identity preamble (already covered by iCloud's opening), factory's standalone "Personality" paragraph (iCloud's wording is nearly identical, kept that one). Factory's seam-keeping routing table was partially dropped — replaced with a corrected version using the real future owners (Feynman for ingest, not Lev; Kardia for clients, not Hild).

### soul.md

**Decision:** kept iCloud as-is, untouched. Factory had no soul.md. iCloud's soul.md covers ID/Emoji/Accent/Soul Fragment/Goals/Tool Tags/Handoff Triggers/Memory Namespace/Notes — all of it is still valid and none of the factory material is soul-level (it's all operational mechanics, which belongs in CLAUDE.md).

## Routing table updates (Phase 3)

The canonical Cordis routing table previously had these three rows (among others):

- Content Agent → Corva → `content, draft, publish, newsletter, LinkedIn post, YouTube script, writing`
- Research Agent → Feynman → `research, signal, trend, competitor, analysis, insight, data, evidence`
- PM Agent → Kardia → `project, milestone, delivery, timeline, sprint, scope, deadline, coordination`

Today's scope-reassignment decision extended Feynman / Corva / Kardia but did not update Cordis. Merged keyword sets (old + new) in both `identity.md` and `CLAUDE.md`:

- **Corva:** `content, draft, outline, script, newsletter, repurpose, carousel, show notes, essay, edit, publish, LinkedIn post, YouTube script, writing`
- **Feynman:** `research, signal, trend, competitor, analysis, insight, data, evidence, voice memo, transcribe, ingest, youtube, rss, feed, clustering, observation`
- **Kardia:** `project, milestone, delivery, timeline, sprint, scope, deadline, coordination, CFCS, Liv, Culture Project, ZPM, Real + True, client status, deliverable`

Tokamak / Lev / Axel / Hild rows are unchanged.

## Final file sizes

```
$ wc -l "$COWORK_PATH/Agent Personalities/agents/cordis/"*.md
      71 identity.md   (was 55 iCloud / 46 factory)
     128 CLAUDE.md     (was 54 iCloud / 97 factory)
      59 soul.md       (unchanged)
     258 total
```

Both merged files comfortably under the 500-line ceiling from the dispatch brief.

## Factory deletion — confirmed

```
rm /Users/edmundmitchell/factory/agents/cordis/identity.md  # exit 0
rm /Users/edmundmitchell/factory/agents/cordis/CLAUDE.md    # exit 0
rmdir /Users/edmundmitchell/factory/agents/cordis           # exit 0
rm /Users/edmundmitchell/factory/agents/.DS_Store           # (macOS cruft remaining)
rmdir /Users/edmundmitchell/factory/agents/                 # exit 0
```

`/Users/edmundmitchell/factory/agents/` no longer exists. Post-check: `ls -la /Users/edmundmitchell/factory/ | grep -i agents` returns nothing.

## Files changed

- `/Users/edmundmitchell/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork/Agent Personalities/agents/cordis/identity.md` (overwritten with merged version)
- `/Users/edmundmitchell/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork/Agent Personalities/agents/cordis/CLAUDE.md` (overwritten with merged version)
- `/Users/edmundmitchell/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork/Agent Personalities/agents/cordis/soul.md` (untouched)
- `/Users/edmundmitchell/factory/agents/cordis/*` (deleted — whole folder gone)
- `/Users/edmundmitchell/factory/agents/` (deleted — empty after cordis removal)

## Follow-ups flagged

1. **Dashboard agent loader smoke-test.** The dashboard is supposed to read the canonical iCloud Cordis. Worth a sanity test that it still parses after the merge (new `## Primary Remit (Phase 3 MVP)` section, longer CLAUDE.md).
2. **Routing in practice.** The routing keywords now include `voice memo`, `CFCS`, `Liv`, etc. spelled out explicitly. Edmund should validate that "ingest the voice memo" lands on Feynman and "CFCS status update" lands on Kardia, not Cordis-stays-orchestration.
3. **Other agent folders.** Only Cordis was touched here. No changes to Tokamak / Lev / Corva / Feynman / Axel / Hild / Kardia. The earlier scope-reassignment edits to Feynman/Corva/Kardia CLAUDE.md files (appended `## Rebuild 2026-04-17 extensions` blocks) remain authoritative.

## Surprises

- **Factory agents/ held a .DS_Store** — macOS filesystem cruft. Didn't block the cleanup; removed it alongside the cordis folder so `rmdir agents/` could succeed.
- **No soul.md in factory.** Not a surprise given the dispatch brief predicted this, but worth confirming: the Phase-3 rewrite only touched operational wiring, not soul-level voice. iCloud's soul.md remains canonical and untouched.
- **Cordis's canonical routing table hadn't been touched today.** The scope-reassignment memo explicitly deferred this — good, we closed that gap.
