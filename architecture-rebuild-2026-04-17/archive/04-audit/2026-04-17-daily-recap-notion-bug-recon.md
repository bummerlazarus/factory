# Daily Recap Notion Permission Prompt — Recon Report
**Date:** 2026-04-17  
**Status:** Investigation complete — permission model mismatch identified

---

## Executive Summary

The factory daily recap scheduled task (`factory-daily-recap`) runs via the scheduled-tasks MCP at 21:00 Chicago time nightly. During execution, it calls `mcp__c539fb18-*__notion-update-page` to post the recap to Notion, but the pre-approved Notion tools in `settings.json` are from a different MCP server (`mcp__claude_ai_Notion__*`). This UUID mismatch causes the prompt to appear mid-run, blocking the unattended scheduled execution.

---

## Where the Recap Lives

### Scheduled Task Configuration
- **Scheduled-tasks MCP managed task:** `factory-daily-recap`
- **Cron schedule:** `0 21 * * *` (09:06 PM daily Chicago time, with 369s jitter)
- **Location:** `/Users/edmundmitchell/.claude/scheduled-tasks/factory-daily-recap/SKILL.md`
- **Status:** Enabled, last run 2026-04-18T02:11:34.108Z

### Skill Definition
- **Primary skill:** `/Users/edmundmitchell/factory/skills/daily-recap/SKILL.md`
- **Execution flow:**
  1. Query Supabase (`execute_sql`) for today's work_log grouped by project, approved skill_versions, pending proposals
  2. Render 5-line Markdown summary (template fixed per spec)
  3. **Post to Notion** via Notion MCP (`notion-update-page`)
  4. Insert `work_log` row kind='note' to track the recap itself

### Why It Runs Unattended
The scheduled-tasks MCP is a first-party Anthropic MCP that launches a Claude Code agent session autonomously on a cron schedule. No human interaction expected. The agent session runs with permissions specified in `/Users/edmundmitchell/.claude/settings.json`.

---

## Why It Prompts for Notion Permission

### The MCP UUID Mismatch

**In `settings.json` (pre-approved Notion tools):**
```json
"mcp__claude_ai_Notion__notion-search",
"mcp__claude_ai_Notion__notion-fetch",
"mcp__claude_ai_Notion__notion-create-pages",
"mcp__claude_ai_Notion__notion-update-page",
```

**Available in system (from function signatures):**
```
mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-create-pages
mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-update-page
mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-fetch
[etc.]
```

**Root cause:** The pre-approved list uses the old `claude_ai_Notion` server UUID. The currently connected Notion MCP is the official Notion plugin (`c539fb18-...`), which is a different server with a different UUID. When the scheduled task agent attempts to call `mcp__c539fb18-*__notion-update-page`, the harness cannot find a matching pre-approval in settings.json and prompts for permission.

### The Specific Call Site

From `/Users/edmundmitchell/factory/skills/daily-recap/SKILL.md` step 4:
> **Post unless `--dry-run`**: Notion: append a block to the "Daily Recaps" page (Notion MCP `notion-update-page`).

The skill instructs the agent to use the live Notion MCP (which is `c539fb18-...`), but that server UUID is not in the allowlist.

---

## Fix Options

### Option A: Update settings.json Pre-Approval Allowlist (Fast, Local)

**Action:** Replace the old `mcp__claude_ai_Notion__*` entries in `settings.json` with the new `mcp__c539fb18-*` UUIDs.

**File:** `/Users/edmundmitchell/.claude/settings.json`

**Change:**
```json
// Before
"mcp__claude_ai_Notion__notion-search",
"mcp__claude_ai_Notion__notion-fetch",
"mcp__claude_ai_Notion__notion-create-pages",
"mcp__claude_ai_Notion__notion-update-page",

// After
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-search",
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-fetch",
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-create-pages",
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-update-page",
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-query-database-view",
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-get-comments",
```

**Pros:**
- Ships immediately (one file edit, no code changes)
- Fixes the scheduled task and all interactive sessions
- Already being used successfully in manual runs (no compatibility concerns)

**Cons:**
- Cosmetic fix — doesn't improve architecture
- Notion remains in the critical path for automated recap generation
- No progress toward "Supabase-first" rebuild direction

**Timeline:** < 5 minutes

---

### Option B: Migrate Recap to Write Supabase, Skip Notion (Aligned with Rebuild)

**Action:** Rewrite the daily recap to post a row to Supabase instead of Notion. Store the rendered 5-line summary in a `daily_recaps` table and/or in `home_cards` (currently sketched in the skill but marked MVP-deferred).

**Files:**
- `/Users/edmundmitchell/factory/skills/daily-recap/SKILL.md` — update step 4 to call Supabase instead
- `/Users/edmundmitchell/.claude/settings.json` — add Supabase `execute_sql` to allow list (already present)
- New migration: create `daily_recaps` table in Supabase with columns: `date`, `summary_md`, `projects_active`, `skills_approved`, `proposals_pending`, `created_at`

**Changes (rough):**
1. Keep steps 1–3 (queries + render) unchanged
2. Step 4: Replace `notion-update-page` with `execute_sql` INSERT into `daily_recaps`
3. Still insert `work_log` row (step 5)
4. Notion write is removed entirely

**Pros:**
- **Aligns with rebuild direction.** The rebuild prioritizes Supabase as the source of truth for agent observations. Notion remains a UI surface, not a write target from automation.
- **No permission prompt.** Supabase MCP is already in the pre-approved list.
- **Decouples from Notion availability.** Recap doesn't fail if Notion auth expires or MCP is unavailable.
- **Sets a pattern.** Future automated summaries (weekly, monthly) can follow the same Supabase-write model.
- **Supports the home-card surface.** The `home_cards` upsert (currently deferred) becomes possible once the Supabase table exists.

**Cons:**
- Requires schema migration (1 new table)
- Requires skill rewrite (3–4 steps)
- Notion "Daily Recaps" page goes silent (Edmund still sees recaps via Supabase/home-cards, but not in Notion)
- **Risk:** If Edmund is manually reading the Notion "Daily Recaps" page, this breaks the habit loop

**Timeline:** 30–45 minutes (migration + skill rewrite + test)

---

## Recommendation

**→ Ship Option A immediately (fix the UUID mismatch), then queue Option B for the next sprint.**

### Rationale

1. **Unblock the critical path.** The scheduled task is running but blocking. Option A fixes it with no risk in < 5 minutes.

2. **Respect the rebuild direction without forcing it.** The rebuild is still in Phase 3 (designs underway). The Notion audit (2026-04-17) confirms Notion is the source of truth for ops data *right now*. Forcing a Supabase migration on the recap before the broader notebook-first architecture is finalized creates a pattern mismatch and technical debt.

3. **Option B becomes a follow-up decision.** Once the home-card surface is ready and the rebuild phase reaches ops migration, the recap naturally moves to Supabase as part of the broader ops observability system.

4. **Reduce risk of regression.** Edmund is likely accustomed to seeing the daily recap in Notion. A quick UUID fix keeps the experience stable while deeper refactoring happens.

### Implementation Sketch (Option A)

**File:** `/Users/edmundmitchell/.claude/settings.json`

**Lines ~56–59:** Replace old Notion UUIDs

```json
"allow": [
  // ... (keep existing entries)
  // Old: "mcp__claude_ai_Notion__notion-search",
  "mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-search",
  // Old: "mcp__claude_ai_Notion__notion-fetch",
  "mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-fetch",
  // Old: "mcp__claude_ai_Notion__notion-create-pages",
  "mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-create-pages",
  // Old: "mcp__claude_ai_Notion__notion-update-page",
  "mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-update-page",
  // Add companion tools for robustness:
  "mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-query-database-view",
  // ... (rest of allow list)
]
```

**Verification after fix:**
```bash
# Run the scheduled task manually to verify no prompt appears
# Expected: full 5-line recap posted to Notion, work_log row inserted, exit 0
```

---

## Follow-up Questions for Edmund

1. **Is the "Daily Recaps" Notion page mission-critical to your workflow?** (If you're actively reading it, Option B may disrupt your habit. If it's just a log surface, Option B is safer to pursue sooner.)

2. **Does the rebuild schedule require ops automation to move off Notion before Q2?** (This informs whether Option B is queued for next sprint or deprioritized in favor of other rebuild phases.)

3. **Should we add `notion-create-pages` to the UUID fix, or is `notion-update-page` sufficient?** (The skill says "create if missing" — being explicit helps.)

---

## References

- **Scheduled task config:** `mcp__scheduled-tasks__list_scheduled_tasks` output; cron `0 21 * * *`
- **Skill definition:** `/Users/edmundmitchell/factory/skills/daily-recap/SKILL.md` (lines 3–6, 44–58)
- **Scheduled task wrapper:** `/Users/edmundmitchell/.claude/scheduled-tasks/factory-daily-recap/SKILL.md` (lines 4, 13, 17)
- **Notion audit:** `/Users/edmundmitchell/factory/architecture-rebuild-2026-04-17/04-audit/2026-04-17-notion-audit.md` (confirms Notion MCP as required, line 180)
- **Settings.json:** `/Users/edmundmitchell/.claude/settings.json` lines 56–59, 112

