# RLS Current State — 2026-04-17 (pre Phase 0.5)

Snapshot of policies + RLS status for the four Phase 0.5 target tables, plus advisor findings.

## RLS enable status

| Table | RLS enabled | RLS forced |
|---|---|---|
| `scorecard_responses` | ✅ | ❌ |
| `vault_files` | ✅ | ❌ |
| `agent_conversations` | ❌ | ❌ |
| `agent_scratchpad` | ❌ | ❌ |

## Policies (before fix)

### `scorecard_responses`
| policy | cmd | qual | with_check | status |
|---|---|---|---|---|
| `admin_select_scorecard` | SELECT | `auth.role() = 'authenticated'` | — | keep |
| `admin_delete_scorecard` | DELETE | `auth.role() = 'authenticated'` | — | keep |
| `public_insert_scorecard` | INSERT | — | `true` | keep (public form submission) |
| `public_update_scorecard` | UPDATE | `true` | `true` | **DROP — the bug** |

### `vault_files`
| policy | cmd | qual | with_check | status |
|---|---|---|---|---|
| `service_role_full_access` | ALL | `true` | `true` | keep (service_role) |
| `authenticated_read_all` | SELECT | `auth.role() = 'authenticated'` | — | keep |
| `anon_read_by_token` | SELECT | `auth.role() = 'anon'` | — | **DROP — leaks all rows to anon** |

## Additional advisor findings (outside Phase 0.5 scope, flagged for later)

### ERROR — RLS disabled on public tables
- `signals`, `competitors`, `content_items`, `content_topics`, `topics`, `ai_analyses`, `scrape_runs` — the competitive intelligence cluster
- Plus the two we're fixing: `agent_conversations`, `agent_scratchpad`

### WARN — always-true RLS policies
- `contact_submissions.Enable insert access for all users` (public form — keep; acceptable)
- `lead_magnet_submissions.Enable insert access for all users` (public form — keep)
- `scorecard_responses.public_insert_scorecard` (public form — keep)
- `scorecard_responses.public_update_scorecard` (**the bug** — fixing)
- `vault_files.service_role_full_access` (service role — keep; advisor can't tell it's scoped)
- `waitlist.Enable insert access for all users` (public form — keep)

### WARN — function search_path mutable
- `public.update_vault_files_updated_at`
- `public.dc_set_updated_at`
- `public.log_factory_event`

### WARN — other
- Public storage bucket `media` has broad listing SELECT policy
- Leaked password protection disabled in Supabase Auth

Follow-ups beyond Phase 0.5 — add to `03-decisions/open-questions.md` as Q10 or a dedicated security hardening phase.
