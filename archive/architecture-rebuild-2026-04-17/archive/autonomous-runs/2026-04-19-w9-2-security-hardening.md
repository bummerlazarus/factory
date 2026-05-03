# W9.2 — Q10 security hardening

**Date:** 2026-04-19
**Epic:** W9.2
**Status:** 🟢 DONE (modulo Edmund's manual leaked-password toggle)
**Plan:** [`05-design/plans/2026-04-19-w9-2-security-hardening.md`](../../05-design/plans/2026-04-19-w9-2-security-hardening.md)
**Branch:** `feat/w9-2-security-hardening` (dashboard repo, commit `8b12133`)

## Decisions (Edmund, 2026-04-19)

1. ✅ Approve Migrations A+B+C as one run.
2. ✅ Apply Migration D (tighten `media` bucket). Orchestrator investigated — 28 objects uploaded March 2026, no anon-key `.list()` callers in factory, dashboard, gravityclaw, or docs. Safe.
3. ✅ Roll the 4 post-Q10 surprise tables into A+B (`agent_run_logs`, `reference_docs_kinds`, `beehiiv_post_metrics`, `workstreams`).
4. ✅ Edmund handles leaked-password toggle manually.

## Migrations applied

Applied live to Supabase project `obizmgugsqirmnjpirnh` via `apply_migration`.

| # | Name | Effect |
|---|---|---|
| A | `20260419100000_enable_rls_competitive_intel` | `ENABLE ROW LEVEL SECURITY` on 11 tables |
| B | `20260419100100_policies_competitive_intel` | `service_role_all` policy per table |
| C | `20260419100200_fix_function_search_path` | `SET search_path = pg_catalog, public` on 3 functions |
| D | `20260419100300_tighten_media_bucket` | `DROP POLICY "Public read access on media"` |

## Verification output

### Acceptance #1 — RLS enabled

```
relname                | relrowsecurity
-----------------------+----------------
agent_run_logs         | t
ai_analyses            | t
beehiiv_post_metrics   | t
competitors            | t
content_items          | t
content_topics         | t
reference_docs_kinds   | t
scrape_runs            | t
signals                | t
topics                 | t
workstreams            | t
```
11/11 ✅

### Acceptance #2 — service_role policies

11 rows returned, all with `policyname='service_role_all'`, `roles='{service_role}'`, `cmd='ALL'`. ✅

### Acceptance #3 — function search_path

```
proname                        | proconfig
-------------------------------+--------------------------------------
dc_set_updated_at              | {search_path=pg_catalog, public}
log_factory_event              | {search_path=pg_catalog, public}
update_vault_files_updated_at  | {search_path=pg_catalog, public}
```
3/3 ✅

### Acceptance #4 — security advisor

All Q10 lints cleared:
- ✅ `rls_disabled_in_public` — 0 (was 7 in Q10 + 4 post-Q10)
- ✅ `function_search_path_mutable` — 0 (was 3)
- ✅ `public_bucket_allows_listing` — 0 (was 1)
- ⏳ `auth_leaked_password_protection` — 1 (Edmund's manual toggle pending)

Remaining lints are all pre-existing, documented as out-of-scope in the plan:
- 6× `rls_enabled_no_policy` (INFO) — agent_conversations, agent_memory, agent_scratchpad, agent_tasks, slack_messages, workspace_items
- 1× `security_definer_view` (ERROR) — `content_metrics_unified`
- 2× `extension_in_public` (WARN) — pg_net, vector
- 6× `rls_policy_always_true` (WARN) — contact_submissions, lead_magnet_submissions, scorecard_responses, waitlist (public form INSERT, Q10 says leave), observations (pre-existing auth UPDATE), vault_files (service_role full access, pre-existing pattern)

### Acceptance #5 — signals-ingest still works

`SELECT COUNT(*) FROM signals` returned 83. Service-role bypass confirmed.

## Subagents dispatched

- 1× Plan agent (general-purpose) — wrote the plan with live audit data, flagged 4 surprise tables and 4 decisions for Edmund.
- 1× code-reviewer agent (`superpowers:code-reviewer`) — cleared all 4 migrations, no blockers. Suggested follow-ups captured below.

## Follow-ups

1. **Edmund: toggle leaked-password protection** in Supabase dashboard → Authentication → Policies. Then rerun advisor to confirm clean.
2. **Housekeeping:** the `CREATE FUNCTION` statements for `log_factory_event`, `dc_set_updated_at`, `update_vault_files_updated_at` live outside `/dashboard/supabase/migrations/` (applied out-of-band historically). Worth capturing as migrations so a fresh env reproduces from repo. Not urgent, not part of W9.2.
3. **Noise cleanup (optional):** add `service_role_all` to the 6 RLS-enabled-no-policy tables (`agent_conversations`, `agent_memory`, `agent_scratchpad`, `agent_tasks`, `slack_messages`, `workspace_items`). Same two-line pattern, zero blast radius, clears the advisor to fully green.
4. **Out-of-scope but surfaced:** `security_definer_view` on `content_metrics_unified` (ERROR-level), extensions in public schema. These pre-date W9.2.

## Files touched

- `dashboard/supabase/migrations/20260419100000_enable_rls_competitive_intel.sql` (new)
- `dashboard/supabase/migrations/20260419100100_policies_competitive_intel.sql` (new)
- `dashboard/supabase/migrations/20260419100200_fix_function_search_path.sql` (new)
- `dashboard/supabase/migrations/20260419100300_tighten_media_bucket.sql` (new)

Plan + this run log under `architecture-rebuild-2026-04-17/`.

## Cost

Audit + plan + execution + review: ~$0.10 estimated (plan agent ~80k tokens, review ~47k, plus MCP calls). Well under the $10/run cap.

## What's next

- W9.5 (production promotion of `/dashboard/`) — now unblocked on build (OA.4) + security (W9.2). Still pending: Edmund's leaked-password toggle, Q10-blocked items (W9.2 DONE unblocks Q10 satisfaction), and Edmund approval for prod deploy.
- W1.4 (dual-read parity report) — ready 2026-04-24 (7 days post W1.2).
- Open decisions: Q3, Q8, Q12 still blocking W5.6, W8.2, W9.3.
