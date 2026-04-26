# W9.2 — Q10 security hardening

**Date:** 2026-04-19
**Status:** 🟡 Plan — awaiting Edmund approval on decisions below
**Backlog:** `06-handoffs/backlog.md` W9.2
**Open question:** Q10 in `03-decisions/open-questions.md`
**Supabase project:** `obizmgugsqirmnjpirnh`

## Context

Q10 surfaced five security issues from the Supabase advisor during Phase 0.5. This epic closes four of them (the fifth — always-true INSERT on public form tables — is explicitly left as-is per Q10, since public form submission is the intended use case). The goal is to harden the project before the dashboard goes public on Vercel (W9.5). RLS on service-role-only tables + function search_path + media bucket tightening + a manual Edmund-toggle for leaked-password protection. Per the autonomy charter, "Changing auth / RLS policies on live Supabase beyond what's in the plan" is a hard stop — so this plan must be approved before execute.

## Current state (live audit)

Audit performed 2026-04-19 via Supabase MCP `execute_sql` + `get_advisors`.

### Issue 1 — RLS on 7 competitive-intel tables

| table | rls_enabled | existing_policies | row_count | dashboard callers | client type |
|---|---|---|---|---|---|
| `signals` | **false** | 0 | 83 | `supabase/functions/signals-ingest/index.ts` (3 calls) | service-role |
| `competitors` | **false** | 0 | 8 | — none found | — |
| `content_items` | **false** | 0 | 209 | — none found | — |
| `content_topics` | **false** | 0 | 655 | — none found | — |
| `topics` | **false** | 0 | 20 | — none found | — |
| `ai_analyses` | **false** | 0 | 450 | — none found | — |
| `scrape_runs` | **false** | 0 | 8 | — none found | — |

Evidence: `pg_class.relrowsecurity=false` for all 7; `pg_policies` empty for all 7. Grep of `/dashboard/app/**`, `/dashboard/lib/**`, `/dashboard/app/api/**` for `from('<table>')` patterns returned zero hits; only hit across the repo is `signals-ingest` Edge Function which uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS — continues to work). Historic callers were GravityClaw / Railway, which also use the service role. Advisor confirms: all 7 appear as `rls_disabled_in_public` errors.

**No anon or authenticated client touches these tables today.** Enabling RLS with service-role-only policies is safe — no dashboard page or API route will break.

### Issue 2 — Mutable `search_path` on 3 functions

| function | `prosecdef` | current `proconfig` (search_path) |
|---|---|---|
| `update_vault_files_updated_at` | false | NULL (mutable) |
| `dc_set_updated_at` | false | NULL (mutable) |
| `log_factory_event` | false | NULL (mutable) |

All three are trigger/utility plpgsql. None use `SECURITY DEFINER`. Fix = `ALTER FUNCTION ... SET search_path = pg_catalog, public`. Trigger bodies only reference `now()` and `NEW.*` — zero risk. `log_factory_event` writes to `factory_events` + `factory_sessions`; both are in `public` so pinning search_path to `pg_catalog, public` preserves resolution.

### Issue 3 — `media` storage bucket

Bucket state (`storage.buckets`):
- `public=true`, no file_size_limit, no allowed_mime_types.

Current policies on `storage.objects` filtered to `media`:
1. `Public read access on media` — SELECT, role=public, `qual=(bucket_id='media')`
2. `Authenticated users can upload to media` — INSERT, role=public, auth.role=authenticated
3. `Authenticated users can update media` — UPDATE, role=public, auth.role=authenticated
4. `Authenticated users can delete media` — DELETE, role=public, auth.role=authenticated

Advisor flag: `public_bucket_allows_listing` — the broad SELECT policy allows `list` / enumeration of all files in the bucket via the storage API, not just fetching known object URLs. Public buckets don't need a `SELECT on storage.objects` policy for direct URL access (signed-free `GET /object/public/media/<path>` still works).

### Issue 4 — Leaked-password protection

Advisor flag: `auth_leaked_password_protection` — disabled. **Not fixable via SQL or MCP.** Manual toggle only: Supabase Dashboard → Authentication → Policies → enable "Leaked password protection" (HaveIBeenPwned lookup).

### Issue 5 — Always-true INSERT on form tables (out of scope per Q10)

Advisor confirms always-true INSERT policies on `contact_submissions`, `lead_magnet_submissions`, `waitlist`, `scorecard_responses`. Q10 says "acceptable for public form submission — worth input validation or rate limits." No migration in this epic. Flag for future rate-limit work.

### Surprises from the live audit (not in the Q10 write-up)

These are **out of scope** for W9.2 but worth flagging to Edmund — they showed up in the advisor run:

1. **4 more tables without RLS** beyond the Q10 seven: `agent_run_logs`, `reference_docs_kinds`, `beehiiv_post_metrics`, `workstreams`. All landed after Q10 was written (W5.5, W7.2, W9.1c). Same service-role-only pattern applies. **Recommendation:** roll them into Migration A/B rather than leaving partial coverage.
2. **`security_definer_view` ERROR on `public.content_metrics_unified`** — view runs as creator, not caller. Created by W5.x metrics rollup. Not in Q10 but same severity tier. Out of scope for this plan unless Edmund says otherwise.
3. **Extensions `pg_net` and `vector` in `public` schema** — WARN. Moving them is destructive and risks breaking pgvector callers. Not in scope.
4. **6 tables with RLS enabled but zero policies** (`agent_conversations`, `agent_memory`, `agent_scratchpad`, `agent_tasks`, `slack_messages`, `workspace_items`). Currently means "deny all to non-service-role." Fine as a posture but generates advisor noise. Out of scope.

## Proposed changes

Four migrations, each idempotent, each with a `BEGIN/COMMIT`. Apply in order A → B → C → (D if approved). All filenames use `dashboard/supabase/migrations/YYYYMMDDHHMMSS_<slug>.sql`.

### Migration A — `20260419100000_enable_rls_competitive_intel.sql`

Enables RLS on the 7 Q10 tables. No policies here — tables become deny-all-except-service-role until Migration B lands. Service-role bypasses RLS unconditionally so `signals-ingest` keeps working between A and B.

```sql
BEGIN;

ALTER TABLE public.signals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_analyses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_runs    ENABLE ROW LEVEL SECURITY;

COMMIT;
```

Idempotency: `ENABLE ROW LEVEL SECURITY` is a no-op if already enabled. No `IF NOT EXISTS` clause exists for this statement in Postgres, but re-running is safe.

### Migration B — `20260419100100_policies_competitive_intel.sql`

Service-role full-access policy per table. No anon/authenticated policies (no dashboard caller requires one, per audit). Pattern mirrors `vault_files.service_role_full_access` already in the DB.

```sql
BEGIN;

-- signals
DROP POLICY IF EXISTS service_role_all ON public.signals;
CREATE POLICY service_role_all ON public.signals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- competitors
DROP POLICY IF EXISTS service_role_all ON public.competitors;
CREATE POLICY service_role_all ON public.competitors
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- content_items
DROP POLICY IF EXISTS service_role_all ON public.content_items;
CREATE POLICY service_role_all ON public.content_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- content_topics
DROP POLICY IF EXISTS service_role_all ON public.content_topics;
CREATE POLICY service_role_all ON public.content_topics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- topics
DROP POLICY IF EXISTS service_role_all ON public.topics;
CREATE POLICY service_role_all ON public.topics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ai_analyses
DROP POLICY IF EXISTS service_role_all ON public.ai_analyses;
CREATE POLICY service_role_all ON public.ai_analyses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- scrape_runs
DROP POLICY IF EXISTS service_role_all ON public.scrape_runs;
CREATE POLICY service_role_all ON public.scrape_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
```

Idempotency: each `DROP POLICY IF EXISTS` + `CREATE POLICY` is safe to re-run.

Note: because `service_role` bypasses RLS anyway, these policies are **belt-and-suspenders** — they ensure the table shows "has policies" to the advisor and make the intent explicit. `anon` and `authenticated` roles have no matching policy, so all their access is denied by default (which is the goal).

### Migration C — `20260419100200_fix_function_search_path.sql`

Pins search_path on the 3 functions flagged. `ALTER FUNCTION ... SET search_path = ...` does not change the body, only the setting. Re-running is idempotent.

```sql
BEGIN;

ALTER FUNCTION public.update_vault_files_updated_at()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.dc_set_updated_at()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.log_factory_event(
  uuid, text, text, text, text, text, text, text, text, integer, text, jsonb, text
) SET search_path = pg_catalog, public;

COMMIT;
```

### Migration D (optional, needs Edmund approval) — `20260419100300_tighten_media_bucket.sql`

Drops the broad SELECT policy on `media`. Public URL access (`/storage/v1/object/public/media/<path>`) continues to work without it — only enumeration via the storage list API is blocked.

```sql
BEGIN;

DROP POLICY IF EXISTS "Public read access on media" ON storage.objects;

COMMIT;
```

**Trade-off:** any client currently calling `supabase.storage.from('media').list()` without a service-role key will start returning empty. Grep of the dashboard found no such call, but Edmund should confirm no external tool (old Hermes? Apple Shortcuts?) depends on listing the bucket.

## Decisions requiring Edmund's approval

1. **Approve Migrations A + B + C to ship as one autonomous run?**
   - Recommended: yes. All three are low-blast-radius. Autonomy charter flags "RLS changes" as a hard stop, so this plan approval IS the gating check-in.
   - Caller impact: none (service-role callers unaffected).

2. **Migration D — tighten `media` bucket SELECT policy?**
   - Recommended: yes. Public URLs keep working; listing stops. Q10 calls this out as "may expose more than intended."
   - Trade-off: breaks any caller doing `storage.list('media')` with anon key. None found in dashboard.
   - Edmund check: do any Shortcuts / Hermes / external tools list the media bucket?

3. **Roll the 4 "surprise" tables into Migration A/B?**
   - Tables: `agent_run_logs`, `reference_docs_kinds`, `beehiiv_post_metrics`, `workstreams`.
   - Recommended: yes, same service-role-only pattern. Avoids another half-measure epic later.
   - Alternative: leave as-is for a dedicated W9.2b sweep.

4. **Leaked-password protection (Issue 4) — Edmund does this manually.**
   - Can't be done via MCP. Dashboard → Authentication → Policies → toggle on.
   - Recommended: do it in the same session as approving this plan, then re-run `get_advisors` as part of acceptance.

5. **Out-of-scope items to explicitly defer (ack only, no decision needed):**
   - `security_definer_view` on `content_metrics_unified`
   - Extensions in public schema (`pg_net`, `vector`)
   - 6 RLS-enabled-no-policy tables (noise, not vulnerability)
   - Always-true INSERT on public form tables (Q10 says leave)

## Acceptance criteria

Run these after Migrations A+B+C (and D if approved). All must pass:

1. **RLS enabled on all 7 Q10 tables:**
   ```sql
   SELECT relname, relrowsecurity FROM pg_class
   WHERE relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
     AND relname IN ('signals','competitors','content_items','content_topics','topics','ai_analyses','scrape_runs');
   ```
   Expected: all 7 rows with `relrowsecurity=true`.

2. **Service-role policy exists per table:**
   ```sql
   SELECT tablename, COUNT(*) FROM pg_policies
   WHERE schemaname='public' AND policyname='service_role_all'
     AND tablename IN ('signals','competitors','content_items','content_topics','topics','ai_analyses','scrape_runs')
   GROUP BY tablename;
   ```
   Expected: 7 rows, count=1 each.

3. **Function search_path pinned:**
   ```sql
   SELECT proname, proconfig FROM pg_proc
   WHERE pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
     AND proname IN ('update_vault_files_updated_at','dc_set_updated_at','log_factory_event');
   ```
   Expected: all 3 rows with `proconfig` containing `search_path=pg_catalog, public`.

4. **Advisor clean on the 4 Q10 issues addressed:**
   ```
   mcp__supabase__get_advisors(type=security)
   ```
   Expected: no `rls_disabled_in_public` lints for the 7 tables, no `function_search_path_mutable` lints for the 3 functions, no `public_bucket_allows_listing` for `media` (if D applied), no `auth_leaked_password_protection` (if Edmund toggled).

5. **Live signals-ingest still works:**
   ```sql
   SELECT COUNT(*) FROM signals WHERE created_at > now() - interval '1 day';
   ```
   Expected: non-zero if a signals-ingest ran in the window, else at least no error.

6. **Dashboard smoke test:** boot dev server, load `/` and `/inbox`. Neither page queries these tables so neither should regress. (Optional — included for belt-and-suspenders.)

## Rollback

Per migration:

### A-rollback
```sql
ALTER TABLE public.signals        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitors    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_items  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_topics DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_analyses    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_runs    DISABLE ROW LEVEL SECURITY;
```

### B-rollback
```sql
DROP POLICY IF EXISTS service_role_all ON public.signals;
DROP POLICY IF EXISTS service_role_all ON public.competitors;
DROP POLICY IF EXISTS service_role_all ON public.content_items;
DROP POLICY IF EXISTS service_role_all ON public.content_topics;
DROP POLICY IF EXISTS service_role_all ON public.topics;
DROP POLICY IF EXISTS service_role_all ON public.ai_analyses;
DROP POLICY IF EXISTS service_role_all ON public.scrape_runs;
```

### C-rollback
```sql
ALTER FUNCTION public.update_vault_files_updated_at() RESET search_path;
ALTER FUNCTION public.dc_set_updated_at() RESET search_path;
ALTER FUNCTION public.log_factory_event(
  uuid, text, text, text, text, text, text, text, text, integer, text, jsonb, text
) RESET search_path;
```

### D-rollback
```sql
CREATE POLICY "Public read access on media" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'media');
```

## Execution order

1. **Edmund approves this plan** (decisions 1–4 above).
2. Create git worktree for `w9-2-security-hardening`.
3. Write Migration A file; apply via `mcp__supabase__apply_migration`.
4. **Verify A:** run acceptance query #1. Pause-point — must show 7 × `true`.
5. Write Migration B file; apply.
6. **Verify B:** run acceptance query #2. Pause-point — must show 7 rows.
7. Write Migration C file; apply.
8. **Verify C:** run acceptance query #3. Pause-point — must show 3 rows with search_path.
9. **If decision 2 = yes:** write Migration D; apply; verify policy dropped.
10. **Edmund manually toggles** leaked-password protection in Supabase dashboard.
11. Run `get_advisors(type=security)`. Confirm Q10 lints cleared (acceptance #4).
12. Optional: dashboard smoke test (acceptance #6).
13. Commit + push feature branch. Write run log at `06-handoffs/autonomous-runs/2026-04-19-w9-2-security-hardening.md`. Flip backlog W9.2 to 🟢.

If decision 3 = yes, expand Migrations A and B to include the 4 additional tables before step 3.

## Blast radius

- **Worst case:** an undiscovered anon-key caller hits one of the 7 tables and starts getting empty results or 403s. Mitigation: grep was thorough (`/app`, `/lib`, `/app/api`, `/supabase/functions`, `/ops/scripts`). Only hit was `signals-ingest` (service-role). If something external surfaces, Migration A is trivially reversible.
- **Second worst:** Migration C pins search_path to something that breaks function resolution. Mitigated: bodies only call `now()` (pg_catalog) and table inserts into `public.factory_events` / `public.factory_sessions`. `pg_catalog, public` covers both.
- **Monitoring:** after apply, watch `get_logs(service='postgres')` for RLS denials for ~10 minutes. Any unexpected deny = candidate caller we missed.
- **Rollback trigger:** if any acceptance query fails OR a deny appears from a non-service-role caller we can't explain, roll back the affecting migration and stop.

## What's next

- W9.3 (Pinecone decommission) — blocked on Edmund.
- W9.5 (production promotion of /dashboard/) — depends on this epic landing green.
