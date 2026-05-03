# 2026-04-17 — Supabase / local path cleanup (autonomous run)

**Scope:** Retire stale Edge Functions (`secret-probe`, `instagram-metrics`), remove redundant local paths, check `/factory/agents/cordis/` vs canonical.
**Authority:** Edmund, explicit ("whatever you need to delete... delete by setting up Supabase CLI or handling yourself").
**Branch:** `feat/department-workspace-overhaul` in `dashboard/`.

---

## Summary

| Target | Action | Result |
|---|---|---|
| `secret-probe` Edge Function | TOMBSTONED (410) | v3 deployed |
| `instagram-metrics` Edge Function | TOMBSTONED (410) | v2 deployed |
| `dashboard/supabase/functions/instagram-metrics/` | REMOVED via `git rm` | commit `9550fd0` |
| `/factory/agents/cordis/` | KEPT (not a duplicate — see diff) | no change |
| Backlog W5.4 | Updated to 🔴 ABANDONED | backlog.md edited |

**True delete blocked** — no `SUPABASE_ACCESS_TOKEN` is present in env, `~/.supabase/`, or `dashboard/.env.local`. Supabase CLI is not installed locally. `supabase login` was not run (blocks on browser OAuth, per the task brief). Falling back to Option C (tombstone via MCP `deploy_edge_function`) was acceptable per the brief.

---

## 1. Access-token discovery

- `env | grep -i supabase` → no `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PAT`.
- `~/.supabase/` → does not exist.
- `~/.config/supabase/` → does not exist.
- `dashboard/.env.local` → has anon key, service role, capture secret, publishable key, and `INSTAGRAM_ACCESS_TOKEN=` (empty). **No PAT.**
- `which supabase` → `supabase not found`. CLI not installed globally; `npx supabase` would need the same PAT.

Decision: do not run `supabase login` interactively. Proceed with tombstone via MCP.

---

## 2. `secret-probe` — TOMBSTONED

MCP `deploy_edge_function` with a `410 Gone` body. Response:

```json
{
  "id": "17968571-60fc-4d8a-88a8-6d6141ebcf64",
  "slug": "secret-probe",
  "version": 3,
  "status": "ACTIVE",
  "updated_at": 1776461642981
}
```

Verification (curl with publishable anon key):

```
HTTP 410
{"error":"retired","reason":"secret-probe was a throwaway introspection tool and is permanently disabled. Delete this function from the Supabase dashboard or via CLI.","retired_at":"2026-04-17"}
```

---

## 3. `instagram-metrics` deployed function — TOMBSTONED

Same approach. Response:

```json
{
  "id": "6609efbd-f630-4950-80b3-db58b25bed12",
  "slug": "instagram-metrics",
  "version": 2,
  "status": "ACTIVE",
  "updated_at": 1776461647796
}
```

Verification:

```
HTTP 410
{"error":"retired","reason":"instagram-metrics is retired. Edmund has no IG access token and will not backfill. Wave 5.4 marked ABANDONED in the backlog.","retired_at":"2026-04-17"}
```

Both tombstones include a comment pointing at the CLI command to fully remove them once a PAT exists:

```
npx supabase functions delete <name> --project-ref obizmgugsqirmnjpirnh
```

---

## 4. Local `instagram-metrics/` — REMOVED

```
$ git rm dashboard/supabase/functions/instagram-metrics/{index.ts,README.md}
rm 'supabase/functions/instagram-metrics/README.md'
rm 'supabase/functions/instagram-metrics/index.ts'
```

Commit:

```
9550fd0 chore: remove local instagram-metrics function (W5.4 abandoned)
 2 files changed, 523 deletions(-)
 delete mode 100644 supabase/functions/instagram-metrics/README.md
 delete mode 100644 supabase/functions/instagram-metrics/index.ts
```

Restoration path if IG is ever reinstated: `git checkout 91bc16c -- supabase/functions/instagram-metrics/`.

---

## 5. `/factory/agents/cordis/` — KEPT (differs from canonical)

Diffed both files against `COWORK_PATH/Agent Personalities/agents/cordis/` (iCloud). They are **not duplicates**. They represent two different orchestration models:

| File | `/factory/agents/cordis/` | `COWORK_PATH/.../cordis/` |
|---|---|---|
| `CLAUDE.md` | "Cordis — System Prompt (CEO Desk)" — **capture-first** model: write `work_log`, tag `project`, low-confidence `observations` only, hand retro to Corva. Aligned with the 2026-04-17 Phase-3 MVP. | "Cordis — Active Agent Context" — **orchestrator** model: routing table to Tokamak/Lev/Corva/Feynman/Axel/Hild/Kardia specialists; AntiGravity framing; Core Memory. |
| `identity.md` | Shorter, sharper voice spec. "Not a promoter... writes what happened, routes when needed." | Longer form with a routing table embedded; "orchestration hub." |
| `soul.md` | not present | present (iCloud only) |

The `/factory/agents/cordis/` version is newer (matches W2.1b / capture() / Corva handoff architecture). The iCloud version is the older pre-refactor agent roster.

**Action: no deletion.** Either version may be canonical depending on which model Edmund wants. This needs his call, not an autonomous one.

---

## 6. Verification — final edge-function inventory

`list_edge_functions` post-tombstone confirms all 8 slugs still exist (no deletes happened). Live functions untouched: `capture` (v17), `capture-mcp` (v1), `youtube-ingest` (v6), `youtube-metrics` (v1), `signals-ingest` (v6), `beehiiv-metrics` (v1). Retired: `secret-probe` (v3, 410), `instagram-metrics` (v2, 410).

```
$ git -C dashboard status --short
 M CLAUDE.md
 M components/layout/sidebar.tsx
 M lib/icons.ts
?? app/api/promotions/
?? app/inbox/
?? data/agent-runs/
?? lib/supabase-browser.ts
?? public/carousel-example.html
```

These modifications/untracked files are **unrelated** to this cleanup — they belong to other in-flight work on `feat/department-workspace-overhaul`. The only thing this run committed was the instagram-metrics removal.

---

## What's left for Edmund

1. **True-delete the two tombstoned functions** (optional; tombstones are safe indefinitely). Needs a Supabase PAT from <https://supabase.com/dashboard/account/tokens>, then either:
   - `export SUPABASE_ACCESS_TOKEN=...` and `npx supabase functions delete secret-probe --project-ref obizmgugsqirmnjpirnh && npx supabase functions delete instagram-metrics --project-ref obizmgugsqirmnjpirnh`
   - or delete via Dashboard: Project → Edge Functions → each → Delete.
2. **Decide which Cordis version is canonical.** The `/factory/agents/cordis/` (capture-first) vs the iCloud `/CEO Cowork/.../cordis/` (orchestrator). They diverged; one should win. If the factory version wins, delete the iCloud version. If the iCloud wins, delete `/factory/agents/cordis/`.

---

## Commands run (exit codes)

| Command | Exit |
|---|---|
| `curl ... /functions/v1/secret-probe` | HTTP 410 (success — tombstone verified) |
| `curl ... /functions/v1/instagram-metrics` | HTTP 410 (success — tombstone verified) |
| `git rm supabase/functions/instagram-metrics/{index.ts,README.md}` | 0 |
| `git commit -m "chore: remove local instagram-metrics..."` | 0 (commit `9550fd0`) |

No destructive git commands were needed beyond `git rm` + `git commit`.
