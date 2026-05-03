# W7.2 Plan — Client project scaffolding

**Status:** Draft 2026-04-17. Written by Plan subagent (read-only mode) then persisted by orchestrator. Split recommended into W7.2a/b/c/d — see §7.

## Current state (measured, not assumed)

- `work_log` has exactly **one** distinct `project` value today: `factory` (8 rows). No DC-client or venture tags exist yet. Kardia has not written a single project-tagged capture. Migration pain for W7.2 is effectively zero.
- `reference_docs` has **one** row total (the IOC framework). No `kind='scope'` rows, no `kind='client-scope'`. `reference_docs_kinds` PK is `kind` (not `slug`).
- `agent_tasks` already has `project_slug` column — any `/clients` surface reads from there for the open-tasks count.
- `work_log.kind` is free text; `work_log.artifacts` is JSONB (Kardia's extension specifies `artifacts.client` for DC sub-slug).
- No `projects` table exists. No `v_active_projects` view exists.

## 1. Canonical client list (7 projects + 4 DC sub-clients)

Mirror Kardia's extension 1:1 — no new slugs, no drift.

| `project` slug | Type | Status | Notes |
|---|---|---|---|
| `dc-clients` | umbrella | active | Parent tag for all Digital Continent work. Sub-client lives in `work_log.artifacts.client` (`cfcs` / `liv-harrison` / `culture-project` / `lisa`). |
| `zpm` | internal-venture | active | Zealous Parish Ministers. |
| `real-true` | internal-venture | active | Annotated catechism pipeline. |
| `faith-ai` | internal-venture | active | Faith & AI Project. |
| `em-brand` | personal-brand | active | Personal brand ops. |
| `cordial-catholics` | personal-brand | active | Keep as own slug per Kardia extension; may later collapse into `em-brand`. |
| `factory` | internal-infra | active | Already in use; codify so drift scans don't flag. |

Seven `project` rows plus four DC-client scope docs = **11 reference_docs seed rows** (minimum 10 if we skip the `dc-clients` umbrella scope).

Each scope doc is kind `client-scope` (new vocab entry via `reference_docs_kinds`):

```
slug:      <project-slug>  (or <project>-<client> for DC sub-entities)
kind:      'client-scope'
title:     human-readable name
body:      markdown (name, type, status, retainer terms, contact,
           deliverables, drift-risk indicators, last-touch date)
metadata:  { type, status, retainer, contact, deliverables[],
             drift_risks[], last_touch_at }
```

**Lisa under `dc-clients`, not her own project** — Kardia's extension already slugs her as `artifacts.client='lisa'`. Don't contradict.

## 2. Project tag enforcement — Option (b) FK refactor

Mirrors the W9.1c kind-vocabulary refactor proven same day. Migration pain zero (8 rows, one value `factory`, which is in the seed).

```sql
-- Additive: create the vocabulary table + FK + seed.
CREATE TABLE public.projects (
  slug text PRIMARY KEY,
  title text NOT NULL,
  type text NOT NULL CHECK (type IN ('dc-client-umbrella','internal-venture','personal-brand','internal-infra')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','retired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.projects (slug, title, type) VALUES
  ('factory','Factory rebuild','internal-infra'),
  ('dc-clients','Digital Continent clients','dc-client-umbrella'),
  ('zpm','Zealous Parish Ministers','internal-venture'),
  ('real-true','Real + True','internal-venture'),
  ('faith-ai','Faith & AI Project','internal-venture'),
  ('em-brand','EM personal brand','personal-brand'),
  ('cordial-catholics','Cordial Catholics','personal-brand');

-- FK only after seed.
ALTER TABLE public.work_log
  ADD CONSTRAINT work_log_project_fk
  FOREIGN KEY (project) REFERENCES public.projects(slug)
  ON UPDATE CASCADE ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.work_log VALIDATE CONSTRAINT work_log_project_fk;

ALTER TABLE public.agent_tasks
  ADD CONSTRAINT agent_tasks_project_slug_fk
  FOREIGN KEY (project_slug) REFERENCES public.projects(slug)
  ON UPDATE CASCADE ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.agent_tasks VALIDATE CONSTRAINT agent_tasks_project_slug_fk;
```

Document the "add-a-project via `INSERT ... ON CONFLICT DO NOTHING`" convention in `dashboard/supabase/README.md` (same pattern as W9.1c kinds).

## 3. `/clients` dashboard surface

Route: **`/clients`** (sibling to `/metrics`, `/research`; matches W6.2d's short-route decision).

Server component at `dashboard/app/clients/page.tsx`. Per-project tile:

- **Header:** project title + type badge + status badge.
- **Recent captures:** `SELECT summary, kind, artifacts, created_at FROM work_log WHERE project=$1 ORDER BY created_at DESC LIMIT 5`. For `dc-clients`, group/tab by `artifacts->>'client'`.
- **Open tasks:** `SELECT count(*) FROM agent_tasks WHERE project_slug=$1 AND status NOT IN ('done','rejected','completed')`.
- **Scope preview:** first ~400 chars of the `client-scope` `reference_docs.body` with a "View full scope" disclosure.
- **Drift indicator:** `days_since_last_touch` from most recent `work_log.created_at`. Ramp: green ≤7d, amber 8–14d, red >14d / never.

Sidebar nav entry added manually (1-line, consistent with W6.2d's handling of Edmund's uncommitted sidebar edits).

## 4. Kardia's canonical SQL (go in her CLAUDE.md)

Three snippets — Kardia should never hand-write these.

```sql
-- A. Scope read (before acting on a client)
SELECT slug, title, body, metadata
  FROM reference_docs
 WHERE kind = 'client-scope' AND slug = $1;

-- B. Drift check (per-session sweep)
SELECT p.slug, p.title, p.type,
       max(w.created_at) AS last_touch,
       now()::date - max(w.created_at)::date AS days_quiet
  FROM projects p
  LEFT JOIN work_log w ON w.project = p.slug
 WHERE p.status = 'active'
 GROUP BY p.slug, p.title, p.type
HAVING max(w.created_at) IS NULL
    OR max(w.created_at) < now() - interval '7 days'
 ORDER BY last_touch NULLS FIRST;

-- C. Drift observation write
INSERT INTO observations (kind, confidence, summary, artifacts, session_id)
VALUES ('pipeline_drift', 0.5, $1, jsonb_build_object('project',$2,'client',$3,'days_quiet',$4), $5);
```

Add to Kardia's `## Rebuild 2026-04-17 extensions` block under a new "Canonical SQL" subsection. Pure additive.

## 5. Acceptance criteria

1. `SELECT count(*) FROM projects WHERE status='active'` → **7**.
2. `SELECT count(*) FROM reference_docs WHERE kind='client-scope'` → **≥ 10** (7 projects + ≥3 DC sub-client scopes; `dc-clients` umbrella scope doc optional).
3. `INSERT INTO work_log (project, kind, summary) VALUES ('not-a-real-project','test','x')` → FK violation.
4. `INSERT INTO work_log (project, kind, summary) VALUES ('cfcs', …)` → FK violation (cfcs is a sub-client, not a project slug; Kardia must write `project='dc-clients', artifacts={client:'cfcs'}`).
5. `/clients` HTTP 200, renders all 7 project cards, `factory` card shows live recent captures.
6. Drift query returns all 6 non-factory projects as "never touched" on day one.
7. Kardia's CLAUDE.md contains the three canonical SQL snippets verbatim.

## 6. Verification steps

```
# Schema
psql -c "\d projects"
psql -c "SELECT conname FROM pg_constraint WHERE conname IN ('work_log_project_fk','agent_tasks_project_slug_fk');"

# Data
SELECT * FROM projects ORDER BY slug;
SELECT slug, kind, title FROM reference_docs WHERE kind='client-scope' ORDER BY slug;

# FK bite test (must error)
INSERT INTO work_log(project,kind,summary) VALUES ('typo-slug','note','x');

# Dashboard
curl -I http://localhost:3000/clients  # expect: 200
```

## 7. Subagent delegation (split into 4)

| Sub-epic | Scope | Size | Depends on |
|---|---|---|---|
| **W7.2a** | Canonical project list + scope docs. Migration adds `client-scope` kind; seeds 11 `reference_docs` rows. No FK yet. | **S** | W7.1b |
| **W7.2b** | FK refactor: create `public.projects`, add FKs to `work_log` + `agent_tasks` with `NOT VALID` + `VALIDATE`. Document add-a-project convention in `dashboard/supabase/README.md`. | **S** | W7.2a |
| **W7.2c** | `/clients` dashboard surface. Server component; three SQL queries per tile; drift ramp coloring. Sidebar line (manual). | **M** | W7.2b |
| **W7.2d** | Kardia CLAUDE.md extension update — "Canonical SQL" subsection with three snippets; codify the `project='dc-clients' + artifacts.client=<slug>` pattern explicitly. | **S** | W7.2a |

Total effort: **M** (~1 long run or 2 tight runs end-to-end).

## 8. Risks / ambiguities — need Edmund to resolve

Three blockers before W7.2a can ship:

1. **Is Lisa in scope as a 4th DC client?** No contact / cadence / deliverables on file anywhere. If yes, Edmund owes a one-paragraph scope doc (contact, cadence, deliverables).
2. **`em-brand` vs `cordial-catholics` — one project or two?** Same human, potentially different streams. Recommend merge to `em-brand` + `artifacts.stream='cordial-catholics'`. Ships cleaner.
3. **IOC placement.** Its own project, part of `real-true`, or infrastructure (no project tag)? Recommend "no project tag" to keep drift noise down.

Secondary (can ship through):

- Kardia's extension enumerates `artifacts.client ∈ {cfcs, liv-harrison, culture-project, lisa}` — if Lisa dropped, tighten to 3.
- `ON DELETE SET NULL` on `work_log.project` vs `RESTRICT` — pick `RESTRICT` unless Edmund wants retirements to orphan captures silently.
- `/clients` exposure vs RLS hardening (Q10 `⛔`) — fine for dev, flag in run log.

## References

- Kardia's scope extension: `$COWORK_PATH/Agent Personalities/agents/pm/CLAUDE.md`
- W9.1c kind-vocabulary refactor (proven pattern): `06-handoffs/autonomous-runs/2026-04-17-kind-vocabulary-refactor.md`
- W6.2d short-route decision: `06-handoffs/autonomous-runs/2026-04-17-w6-2d-inbox-research.md`
- Kardia scope-reassignment decision: `03-decisions/2026-04-17-agent-scope-reassignment.md`
