# Run log — 2026-04-17 daily-recap Notion permission fix

**Epic:** bugfix (not a wave epic — flagged in handoff #4 "Factory daily recap Notion bug")
**Status:** 🟢 DONE
**Recon doc:** [`04-audit/2026-04-17-daily-recap-notion-bug-recon.md`](../../04-audit/2026-04-17-daily-recap-notion-bug-recon.md)

## Problem

The scheduled task `factory-daily-recap` (cron `0 21 * * *` Chicago, via scheduled-tasks MCP) prompted mid-run for Notion permission, blocking unattended execution. Recon pinpointed a **Notion MCP server UUID mismatch**: `settings.json` pre-approved `mcp__claude_ai_Notion__*` tools (old server), but the connected Notion plugin is `mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__*`. The harness couldn't match the call to an approval and prompted.

## Fix applied — Option A (additive allow-list)

Added the new UUID's four core Notion tools + three companion tools to `/Users/edmundmitchell/.claude/settings.json` `permissions.allow` (kept the old entries in place for safety):

```
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-search",
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-fetch",
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-create-pages",
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-update-page",
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-create-comment",
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-query-database-view",
"mcp__c539fb18-7f1b-47cc-8c2e-f6a906f88444__notion-get-comments",
```

## Why additive not replacement

Recon recommended replacement. I left the old `mcp__claude_ai_Notion__*` entries in place because:
1. They do no harm — they match no active server, so they're inert.
2. If Edmund ever re-enables the old Notion server (e.g., reverting the plugin), the recap keeps working without another settings edit.
3. The delta is surgical (only 7 lines added), not a rewrite.

If Edmund wants the old entries removed for hygiene, one follow-up edit handles it.

## Verification

Cannot run the scheduled task on-demand from this session; next automatic firing is 21:00 America/Chicago tonight. If it still prompts, escalate to Option B (migrate recap to Supabase `daily_recaps` table — 30–45 min, aligned with the rebuild direction).

## Follow-ups

- **Confirm tonight's 21:00 CT recap completes unattended** — if not, migrate to Supabase writes (Option B in recon).
- **Notion audit hygiene** — the old `claude_ai_Notion` server UUID is dead; sweep other skill/hook configs for stale references.
- **Edmund decisions pending** (from recon §"Follow-up Questions"):
  1. Is the Notion "Daily Recaps" page mission-critical, or just a log surface?
  2. Does the rebuild schedule require moving recap off Notion before Q2?
  3. (Resolved implicitly by this fix — `notion-create-pages` was added alongside `notion-update-page`.)

## Files touched

- `/Users/edmundmitchell/.claude/settings.json` (additive: 7 lines added to `permissions.allow`)
- `/Users/edmundmitchell/factory/architecture-rebuild-2026-04-17/04-audit/2026-04-17-daily-recap-notion-bug-recon.md` (recon doc; written by recon subagent)

## Charter note

Per the autonomy charter, `~/.claude/` is normally off-limits "beyond memory updates". This edit is carved out by Edmund's explicit queue item #3: "fix so it runs unattended. Likely fix: pre-approve via hook, or migrate the recap…". Documenting here so the audit trail is clean.
