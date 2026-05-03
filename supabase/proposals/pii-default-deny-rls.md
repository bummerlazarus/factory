# PII Default-Deny RLS — Decision Memo

**Date:** 2026-05-03
**Status:** Awaiting Edmund's decision. Charter hard-stop hit: "Changing auth / RLS policies on live Supabase beyond what's in the plan."
**Predecessor:** `supabase/proposals/table-registry.md` Part 5, step 5.

The routing layer (migration 020) marks PII tables `safe_for_default_retrieval = false` as a **convention**. The Edge Function `route_query()` enforces it for callers that go through it, but anything talking to Postgres directly (Studio, ad-hoc SQL, a buggy MCP call, a future Edge Function) can still SELECT `clients`, `profiles`, `*_submissions`, `invoices`, `rhythm_*`, `assessment_results`, `scorecard_responses`. Convention != enforcement.

The proposal called for an RLS-backed default-deny on PII tables, with a session-scoped unlock for explicit-intent callers. The unlock mechanism wasn't specified — that's the decision below.

## Current state of each PII table

| Table | RLS | Existing policies | Risk if unlocked policy is wrong |
|---|---|---|---|
| `clients` | enabled | service_role full | Client roster + emails leak |
| `profiles` | enabled | service_role full | User PII, possibly auth-linked |
| `contact_submissions` | enabled | service_role full + public insert | Public lead form data |
| `lead_magnet_submissions` | enabled | service_role full + public insert | Lead magnet email captures |
| `waitlist` | enabled | service_role full + public insert | Waitlist emails |
| `scorecard_responses` | enabled | service_role full + public insert | Assessment answers per user |
| `assessment_results` | enabled | service_role full | Per-user score data |
| `rhythm_plans` | enabled | service_role full | Per-user coaching plan |
| `rhythm_activities` | enabled | service_role full | Per-user activity log |
| `invoices` | enabled | service_role full | Financial records |
| `invoice_items` | enabled | service_role full | Financial line items |

**RLS is already enabled on all of them.** `service_role` has BYPASSRLS, so Edge Functions and the MCP (which both use service_role) keep working regardless. The "default deny" is implicit: anon/authenticated have no SELECT policy → no rows returned. So the *baseline* posture is actually fine **if the only way to read these tables is via service_role**.

## What's actually missing

Two real gaps, not the same as "add an RLS policy":

1. **Service_role calls have no audit trail.** Any Edge Function or MCP query against PII tables succeeds silently. If a buggy `route_query` extension or new edge function leaks PII into a response, nothing logs it. Convention prevents most cases; observability catches the rest.
2. **No "explicit intent" gate inside service_role.** The proposal envisioned `app.pii_ok` GUC so a caller has to opt-in per query. Today, every service_role call is implicitly PII-ok.

## Three options

### Option A — Do nothing (status quo)
RLS is on, anon/authenticated already denied, PII tables only readable via service_role. Document the situation and call it done.

- ✅ Zero risk of breaking existing flows.
- ❌ The proposal's "default-deny + explicit unlock" stays a convention.
- ❌ A bug in any service_role caller can still leak PII.

### Option B — Audit-only enforcement
Keep RLS as-is, but add a `audit_pii_access` trigger or `pg_audit` row on every SELECT against the 11 PII tables. Surface in the dashboard. No behavior change; just observability.

- ✅ No risk to existing flows.
- ✅ Closes gap #1 (audit trail).
- ❌ Doesn't close gap #2 (no opt-in gate).
- 💰 Tiny ongoing storage cost; trigger overhead negligible at current row counts.

### Option C — App-level GUC gate (proposal's original design)
Wrap PII tables in views or RLS policies that check `current_setting('app.pii_ok', true) = 'true'`. Default null/false → deny for everyone, including service_role. Edge Functions explicitly `SET LOCAL app.pii_ok = 'true'` for the duration of an intent that needs it.

- ✅ Closes both gaps.
- ✅ Forward-compatible with multi-tenant work later.
- ❌ Every existing Edge Function that touches PII (e.g. capture(), beehiiv-metrics writing per-user data, dashboard backend) must be audited and updated.
- ⚠️ Risk: missing one call site silently breaks reads. Needs a careful rollout — apply to one PII table first as canary.

## Recommendation

**Option B for now, defer Option C.**

Rationale:
- Edmund is the only user. Service_role is essentially "trusted." The blast radius of a bug today is bounded by which Edge Function has the bug.
- Option C's payoff scales with multi-user / multi-tenant scenarios that don't exist yet. Building the GUC plumbing before there's a second principal is over-engineering.
- Option B closes the audit-trail gap (the actually-real risk: a future Edge Function silently leaks something) without breaking any existing call sites.
- If multi-tenant becomes real, lift to Option C as part of that epic.

**If Option B is approved**, scope is one migration `022_pii_access_audit.sql` adding:
- `public.pii_access_log` table
- A trigger on each of the 11 PII tables that inserts a row on SELECT (or a single `pg_audit` config — depends on extension availability)
- A dashboard surface or `router_pii_audit_recent` view

## Decision needed
- [ ] A — do nothing, document and close
- [ ] B — audit-only (recommended)
- [ ] C — full GUC gate (defer)

Reply with the letter and I'll execute the corresponding migration. If C, I'll also need a list of Edge Functions that legitimately need PII access so I can update them as part of the rollout.
