# Plan: agent personas + per-agent auto-memory in Supabase (v2)

**Status:** Draft v2 2026-05-03 — revised after Codex review. Ready for autonomous execution.
**Author session:** Claude Code (factory main), reviewed by Codex.
**Related:** `ops/docs/agent-source-of-truth.md`, `supabase/functions/curator_pass/`, `dashboard/app/inbox/promotions/`, memory `feedback_agent_source_of_truth.md`.

## Why this plan exists

Three architectural gaps:

1. **Persona files have no self-improving loop.** Curator can propose skill improvements (`skill_versions`) and you approve them through `/inbox/promotions`. The 13 agent persona files (`identity.md` / `soul.md` / `CLAUDE.md`) sit outside that pipeline. Stale references survive for weeks unnoticed (today: Axel still pointing at `gravityclaw` a month after the rebuild).
2. **Per-agent memory is two disjoint things at once.** `public.agent_memory` (legacy, marked `kind='raw'` in `table_registry`) holds three free-text files per agent — context / decisions / learnings — that `agent-runner.ts` injects into autonomous prompts. There's no curated-knowledge equivalent of your personal `MEMORY.md` index.
3. **Disk-as-source-of-truth has a duplicate-source bug class.** Today's iCloud-vs-factory drift caused the dashboard to serve stale prompts. Today's recovery quarantined iCloud, but the bug class will recur with any disk-as-source design.

This plan fixes all three by making **Supabase the source of truth** for both persona content and per-agent curated memory, with a curator-driven proposal/approval flow for both.

## Codex review findings (incorporated)

The v1 plan had ten issues Codex flagged. Each is addressed in v2:

| # | Issue | v2 fix |
|---|---|---|
| 1 | Phase 4 dropped `public.agents`, but it holds `name/role/emoji/accent_color/domain_keywords/tool_tags/sort_order/archived` that the dashboard `Agent` type depends on. | **Don't drop `public.agents`.** Slim it: keep roster columns; drop the markdown body columns (`identity_md`, `claude_md`, `soul_md`) only AFTER `agent_personas` is fully populated and the read path is switched. The two tables are joined at runtime. |
| 2 | Pre-drop grep for `from('agents')` missed multiple call sites (`dashboard/lib/agent-sync.ts`, `dashboard/app/api/admin/sync-agents/route.ts`, etc.). | Phase 4 replaced with a column-removal phase, not a table drop. Audit script enumerates ALL writers to the body columns specifically. |
| 3 | `agent_personas.agent_id` FK was underspecified. | `agent_personas.agent_id text REFERENCES public.agents(id) ON UPDATE CASCADE` — explicit FK to the now-permanent roster table. |
| 4 | Existing `public.agent_memory` (3 files × 13 agents) was missed entirely. | Phase 1 keeps `public.agent_memory` as-is, marks it explicitly legacy. New curated layer is `public.agent_memories` (plural). Migration tool (Phase 2.5) extracts useful curated entries from the legacy free-text files where possible. The two coexist; new tools write to `agent_memories`, old `update_memory` is rebuilt to write curated entries instead of free-text appends. |
| 5 | New `read_agent_memory` tool needed updates in BOTH `COMMUNICATION_TOOLS` definitions AND `executeTool` dispatcher. | Explicit in Phase 6: change both definitions and executor. Existing `read_memory` / `update_memory` tool semantics defined in this plan (see D6 below). |
| 6 | RLS proposal would have leaked full system prompts via anon read. | Service-role-only on all three new tables. Dashboard server uses service role already. No anon paths. |
| 7 | `proposals` table generalization shouldn't make `skill_versions` a view — too much existing code expects table semantics. | `proposals` is the **envelope/inbox** table only. On approval, the row is materialized into `skill_versions` / `agent_personas` / `agent_memories` (kind-dispatched). `skill_versions` stays as the canonical skill version table. No view replacement. |
| 8 | Status vocab inconsistent (`proposed`/`approved`/`active`/`rejected`/`superseded`). | Standardize: `proposed` (curator output) → `approved` (Edmund clicked yes) → `live` (materialized to target table). `rejected` and `superseded` are terminal states. `skill_versions.status='active'` stays as-is for backward compat; `live` is the new vocab in `proposals`. |
| 9 | Phase ordering: curator/promotions generalization needs to ship BEFORE deprecating `sync-agents.mjs` so the new approval path is the only mutation path. | Phases 5 and 6 swapped. Curator+promotions generalization is now Phase 5; sync deprecation is Phase 6. |
| 10 | Two migration trees (root `supabase/migrations/` and `dashboard/supabase/migrations/`); plan didn't say which. | Root `supabase/migrations/` (sequential 031, 032, 033...) is authoritative for new work. `dashboard/supabase/migrations/` is historical; `agents_table.sql` lives there but no new migrations land there. |

## Acceptance criteria

The plan is done when ALL of the following are true:

1. `public.agent_personas` table exists with versioned identity/claude/soul markdown per agent. Service-role RLS only. FK to `public.agents`.
2. `public.agent_memories` table exists with `MEMORY.md`-style typed entries (`feedback`/`project`/`reference`/`user`) per agent. Service-role RLS only.
3. `public.proposals` table exists as the envelope/inbox for `skill` / `persona-edit` / `memory-entry` proposals. Service-role RLS only.
4. `public.agents` retains roster columns (`name`, `role`, `emoji`, `accent_color`, `domain_keywords`, `tool_tags`, `sort_order`, `archived`). Markdown body columns dropped only after Phase 4 verification.
5. `dashboard/lib/agents.ts` reads roster from `agents` and prompt parts from `agent_personas` (latest `live` version), joined at request time.
6. Per-agent system prompts include a memory **index** (names + descriptions only) from `agent_memories`. Full memory bodies fetched on demand via a `read_agent_memory` tool.
7. Curator pipeline writes proposals to `proposals` (kind discriminated). Existing `curator_pass` Edge Function emits `kind='skill'` rows with same payload shape as before; new flow emits `kind='persona-edit'` and `kind='memory-entry'` rows.
8. `/inbox/promotions` page handles all three kinds; approval materializes into the target table and flips `proposals.status` to `live`.
9. `ops/bin/pull-personas-from-db.mjs` writes the latest `live` persona for each agent to disk so Cowork-style workflows still work. `sync-agents.mjs` errors with deprecation notice.
10. End-to-end smoke test: a curator-proposed persona edit goes from proposal → approval → DB update → next dashboard chat session uses the new prompt, with no manual sync step.
11. RLS contract test: anon role cannot read `agent_personas.body`, `agent_memories.body`, or `proposals.payload`.

## Decisions (v2 — locked)

| ID | Decision | Why |
|---|---|---|
| **D1** | Two new tables: `agent_personas` (versioned prompt parts) + `agent_memories` (typed curated entries). Plus `proposals` envelope. | Different lifecycles: personas are versioned slow-changing artifacts; memory entries churn; proposals are short-lived inbox rows. |
| **D2** | `public.agents` stays. Slim it: drop `identity_md`/`claude_md`/`soul_md` columns AFTER `agent_personas` is the read source. | Roster metadata is real and needed; only the markdown bodies move. |
| **D3** | Versioning: append-only rows on `(agent_id, kind, version)`. Latest `status='live'` row per `(agent_id, kind)` wins for runtime reads. Mirrors `skill_versions` mental model. | Audit trail + zero data loss + reuses your existing approval mental model. |
| **D4** | Memory schema: `agent_id`, `name`, `description`, `type` ∈ {feedback, project, reference, user}, `body`, `version`, `status`, `created_by` ∈ {curator, agent, human}, timestamps. UNIQUE on `(agent_id, name, version)`. | Direct port of your personal `MEMORY.md` system. |
| **D5** | Index-at-prompt-build, body-on-demand. System prompt includes `name + description` rows; agent calls `read_agent_memory(name)` tool when it needs full body. | Keeps prompts small. Forces deliberate memory access. |
| **D6** | `proposals` is the envelope/inbox. Approval materializes the payload to its target table; `proposals.status` flips to `live`. `skill_versions` stays as the canonical skill version table. Existing `update_memory` / `read_memory` tools rewritten: `update_memory(name, type, body)` writes a `proposal` of kind `memory-entry` (not direct write — keeps the human-in-loop default). `read_memory()` returns the current memory index for the calling agent. New `read_agent_memory(name)` returns full body. | Keeps existing tool surface stable while routing through the approval pipeline. Direct memory writes still possible via service-role-only direct inserts during migration. |
| **D7** | Status vocab: `proposed` → `approved` → `live`; terminal `rejected` / `superseded`. `skill_versions.status='active'` is preserved for backward compat (= `live` in proposals language). | Minimum churn. |
| **D8** | Migration tree: all new migrations in root `supabase/migrations/`. `dashboard/supabase/migrations/` is historical. | Consistent with 016–030. |
| **D9** | Pull-down: on-demand only via `pull-personas-from-db.mjs`. No cron. Drift checker (Phase 7) writes `observations` if disk diverges from DB. | Disk is now optional / recovery-only. |
| **D10** | Defer factory disk deletion until Phase 7. Defer iCloud quarantine deletion entirely until Edmund spot-checks the non-`agent personalities` subdirs. | Reversibility. |

## Phases

### Phase 1 — schema + RLS

**Migrations (root tree):**

- `supabase/migrations/031_agent_personas.sql`
  - `CREATE TABLE public.agent_personas (id uuid pk, agent_id text NOT NULL REFERENCES public.agents(id) ON UPDATE CASCADE, kind text NOT NULL CHECK (kind IN ('identity','claude','soul')), version int NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','live','rejected','superseded')), proposed_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz, approved_by text, source_refs jsonb DEFAULT '[]'::jsonb, canonical_disk_path text, UNIQUE(agent_id, kind, version));`
  - Indexes: `(agent_id, kind, status)`, `(status, approved_at DESC)`.
  - RLS: enable; `CREATE POLICY service_role_all ON public.agent_personas FOR ALL TO service_role USING (true) WITH CHECK (true);`. No anon policy.
  - Register in `table_registry` as `kind='atlas'`.

- `supabase/migrations/032_agent_memories.sql`
  - `CREATE TABLE public.agent_memories (id uuid pk, agent_id text NOT NULL REFERENCES public.agents(id) ON UPDATE CASCADE, name text NOT NULL, description text NOT NULL, type text NOT NULL CHECK (type IN ('feedback','project','reference','user')), body text NOT NULL, version int NOT NULL, status text NOT NULL DEFAULT 'live' CHECK (status IN ('proposed','approved','live','rejected','superseded')), created_by text NOT NULL CHECK (created_by IN ('curator','agent','human')), created_at timestamptz NOT NULL DEFAULT now(), superseded_at timestamptz, source_refs jsonb DEFAULT '[]'::jsonb, UNIQUE(agent_id, name, version));`
  - Indexes: `(agent_id, status)`, `(agent_id, name, version DESC)`.
  - RLS: service-role only.
  - Register in `table_registry` as `kind='summary'`.

- `supabase/migrations/033_proposals.sql`
  - `CREATE TABLE public.proposals (id uuid pk, kind text NOT NULL CHECK (kind IN ('skill','persona-edit','memory-entry')), target_agent_id text REFERENCES public.agents(id) ON UPDATE CASCADE, target_skill_name text, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','live','rejected','superseded')), rationale text, source_refs jsonb DEFAULT '[]'::jsonb, proposed_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz, approved_by text, materialized_at timestamptz, materialized_target_id uuid);`
  - Indexes: `(status, proposed_at DESC)`, `(kind, status)`, `(target_agent_id, status)`.
  - RLS: service-role only.
  - Register in `table_registry` as `kind='atlas'`.

- `supabase/migrations/034_table_registry_updates.sql`
  - Mark `agent_memory` row as `kind='legacy'` (already legacy in registry; just ensure consistent).

**Verification:** `\d agent_personas`, `\d agent_memories`, `\d proposals`. Anon-role smoke test must fail to read `body`/`payload`.

### Phase 2 — backfill `agent_personas` from `public.agents`

**Script:** `ops/bin/migrate-agents-to-personas.mjs`

- For each row in `public.agents`, insert three `agent_personas` rows: `kind='identity'` from `identity_md`, `kind='claude'` from `claude_md`, `kind='soul'` from `soul_md` (skip if column null/empty).
- `version=1`, `status='live'`, `approved_at=now()`, `approved_by='migration-2026-05-03'`, `canonical_disk_path='/Users/edmundmitchell/factory/CEO cowork/agent personalities/agents/<id>/'`.
- Idempotent (skip on `(agent_id, kind, version=1)` conflict).
- Single transaction.

**Verification:** `SELECT agent_id, kind, length(body) FROM agent_personas WHERE status='live' ORDER BY agent_id, kind;` — 13 × 3 = 39 rows, lengths byte-match `public.agents`.

### Phase 2.5 — backfill curator-extractable entries from `agent_memory` (best-effort)

**Script:** `ops/bin/migrate-agent-memory-to-memories.mjs`

- Read each agent's three legacy files (context, decisions, learnings) from `public.agent_memory`.
- For `decisions`: each `## YYYY-MM-DD` heading becomes a `type='project'` entry with `name='<slug>'`, `description='<first-line>'`, `body='<entry text>'`, `created_by='migration-2026-05-03'`.
- For `learnings`: same pattern but `type='feedback'`.
- For `context`: skip (free-form notes; not a clean entry boundary). Leaves the legacy table intact for now.
- `version=1`, `status='live'`.
- Idempotent on `(agent_id, name, version=1)`.

**Verification:** Spot-check: `SELECT agent_id, type, count(*) FROM agent_memories GROUP BY agent_id, type;`. No assertions on exact counts (best-effort migration); 0 errors.

### Phase 3 — runtime read switch (dashboard)

**Files:**

- `dashboard/lib/agents.ts` — change query: `SELECT a.id, a.name, a.role, a.emoji, a.accent_color, a.domain_keywords, a.tool_tags, a.sort_order, a.archived, ap_identity.body AS identity_md, ap_claude.body AS claude_md, ap_soul.body AS soul_md FROM agents a LEFT JOIN LATERAL (SELECT body FROM agent_personas WHERE agent_id=a.id AND kind='identity' AND status='live' ORDER BY version DESC LIMIT 1) ap_identity ON true ... etc.` Falls back to `agents.identity_md` etc. if no `agent_personas` row exists (transition guard).
- `dashboard/lib/agent-memory.ts` — add `getAgentMemoryIndex(agentId): Promise<{name, description, type}[]>` and `getAgentMemoryEntry(agentId, name): Promise<{body} | null>`. Keep existing legacy file functions; mark them `@deprecated`.
- `dashboard/lib/anthropic.ts` (or system-prompt builder) — append memory index lines: `### Agent memory index (call read_agent_memory(name) for full body)\n- name: description\n...` after the agent's `claude_md`.
- `dashboard/lib/tools.ts`:
  - `COMMUNICATION_TOOLS`: add `read_agent_memory({name: string})` definition.
  - `executeTool`: dispatch `read_agent_memory` to `getAgentMemoryEntry(agentId, name)`. Returns body string or "not found".
  - Existing `read_memory` / `update_memory` tools: keep working but rewrite implementation. `read_memory()` returns the curated index instead of the legacy 3-file content. `update_memory({name, type, description, body})` writes a `proposals` row of `kind='memory-entry'` (NOT a direct insert into `agent_memories`).

**Verification:** `npm run lint && npm run build` clean. Smoke test: curl `/api/chat` against Cordis with a trivial message; system prompt includes the memory index header. New `read_agent_memory` tool callable. Old `update_memory` call now writes to `proposals` not `agent_memory`.

### Phase 4 — drop body columns from `public.agents`

**Pre-condition: comprehensive grep.** Audit script `ops/bin/find-agent-body-readers.mjs` searches for ANY reader of `agents.identity_md` / `claude_md` / `soul_md`:

```
rg -nP "\\bagents\\b.*\\b(identity_md|claude_md|soul_md)\\b" --glob '!archive/**' --glob '!**/node_modules/**'
rg -nP "from\\(['\"]agents['\"]\\).*select.*['\"]?(identity_md|claude_md|soul_md)['\"]?"
```

Must return zero non-comment hits before the drop. If anything found, fix in Phase 3 first.

**Migration:** `supabase/migrations/035_drop_agents_body_cols.sql` — `ALTER TABLE public.agents DROP COLUMN identity_md, DROP COLUMN claude_md, DROP COLUMN soul_md;`

**This is destructive — autonomy charter hard-stop.** Surface to Edmund with a one-paragraph go/no-go memo before applying. Phases 1–3 ship without it.

### Phase 5 — curator + promotions UI generalization (BEFORE deprecating sync)

**Files:**

- `supabase/functions/curator_pass/index.ts`:
  - Existing skill-proposal Stage A/B kept. Output now goes to `proposals` (kind='skill') instead of `skill_versions` (kind=skill payload includes `skill_name`, `proposed_body_diff`, `source_refs` — same shape, different table).
  - Existing `skill_versions` write path retained for backward compat during transition (dual-write for one cycle), then removed.
  - New Stage A prompts for `persona-edit` and `memory-entry` proposals when source data warrants — gated behind a feature flag `CURATOR_PERSONA_PROPOSALS=1` to start; default off.

- `dashboard/app/inbox/promotions/page.tsx`:
  - Fetch from `proposals` (replaces `skill_versions WHERE status='proposed'`). Backward-compat: also fetch any `skill_versions WHERE status='proposed'` until dual-write ends.
  - Group by `kind` in UI.

- `dashboard/app/inbox/promotions/promotion-card.tsx`:
  - Render variants per `kind`. `skill` variant unchanged. `persona-edit` shows agent + diff preview. `memory-entry` shows the proposed entry.
  - On approve, call `/api/promotions` (kind passed through).

- `dashboard/app/api/promotions/route.ts`:
  - Approve handler is kind-dispatched:
    - `skill` → existing behavior (insert into `skill_versions` with `status='approved'`, then `promote-skill.mjs` mechanics).
    - `persona-edit` → insert new row into `agent_personas` with incremented version + `status='live'`; supersede prior `live` row for same `(agent_id, kind)`. Update `proposals.status='live'`, `materialized_target_id`.
    - `memory-entry` → upsert into `agent_memories`. Same status flips.
  - Reject handler sets `proposals.status='rejected'` for any kind.

- `ops/bin/promote-skill.mjs` → renamed/wrapped as `ops/bin/promote-proposal.mjs` (kind-aware). Old name keeps working as alias.

**Verification:** End-to-end smoke test:
1. Insert synthetic `proposals` row of kind `persona-edit` for Cordis (small body change).
2. Approve via `/inbox/promotions` UI.
3. Confirm new `agent_personas` row with `status='live'`, prior row `superseded`.
4. Start a fresh dashboard chat with Cordis; confirm new prompt is live.
5. Repeat with `kind='memory-entry'`.
6. RLS test: anon role cannot read `proposals.payload`.

### Phase 6 — pull-down + sync deprecation

**Files:**

- `ops/bin/pull-personas-from-db.mjs`:
  - For each agent row in `public.agents`, fetch latest `status='live'` `agent_personas` row per kind.
  - Write to `$COWORK_PATH/agent personalities/agents/<id>/{identity.md, CLAUDE.md, soul.md}`.
  - Refuses to write a file whose mtime is newer than the corresponding DB row's `approved_at` — surfaces via `observations` row, exit code 2.
  - `--dry-run` flag for diff preview.

- `ops/bin/sync-agents.mjs`: replace body with deprecation error. Exit code 1.

- `ops/docs/agent-source-of-truth.md`: rewrite. New convention: DB is source. Pull, don't push. Edits go through `/inbox/promotions`. Keep history section.

**Verification:** Run `pull-personas-from-db.mjs`; confirm disk files match DB byte-for-byte after pull. Run old `sync-agents.mjs`; confirm exit 1.

### Phase 7 — drift safeguard + cleanup

**Files:**

- `ops/bin/check-persona-disk-drift.mjs` — daily script that compares disk files to DB latest-`live`. On drift, writes `observations` row with `metadata.persona_drift={agent_id, kind, mtime_disk, approved_at_db}`. No auto-fix.
- Schedule via existing `mcp__scheduled-tasks` infra: daily at 04:00 CT.
- After two consecutive successful drift-checker runs and Phase 6 verification, Edmund runs `rm -rf /Users/edmundmitchell/factory/CEO\ cowork/agent\ personalities/` (autonomy charter hard-stop — Edmund only).
- iCloud quarantine deletion deferred until Edmund spot-checks `archive/icloud-ceo-cowork-quarantine-2026-05-03/{artifacts,brands,research,skills}/`.

**Verification:** Edit a disk file deliberately; drift checker writes `observations` row within 24h.

## Order of operations

```
Phase 1 ─┬─ Phase 2  ─── Phase 3  ─── Phase 5 ─── Phase 6 ─── Phase 7
         └─ Phase 2.5 ─┘                                       │
                                                               │
                              Phase 4 (Edmund go/no-go) ───────┘
```

Phase 1, 2, 2.5 are sequential. Phase 3 depends on Phase 2. Phase 5 depends on Phase 3. Phase 6 depends on Phase 5. Phase 7 depends on Phase 6. Phase 4 (drop body columns) is gated on Edmund approval and can land any time after Phase 3 ships and the audit is clean.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Phase 3 read-path switch deploys before backfill completes; agents disappear. | Phase 3 query has fallback to `agents.identity_md` etc. Deploy is gated on a row-count check (39 `live` rows in `agent_personas` before the read path is allowed to use the LATERAL join). |
| RLS misconfiguration leaks system prompts. | All three new tables are service-role-only. Phase 1 verification includes an explicit anon-role read test that must fail. |
| Curator hallucinates persona-edit proposals. | Stage B review prompt requires source_refs and forbids fabricated agent IDs. Approval is human; default-deny on the UI side. Feature flag (`CURATOR_PERSONA_PROPOSALS`) starts off. |
| Existing `skill_versions` consumers (`delegate`, `route_query`) break during the proposals cutover. | Phase 5 dual-writes for one cycle (proposals + skill_versions); cutover happens in a follow-up plan once `delegate` and `route_query` are updated to read from `proposals` view. |
| `agent_memories` index grows unbounded and bloats every system prompt. | Cap index at 50 entries per agent in `getAgentMemoryIndex`. Superseded entries filtered out. Pagination on direct reads. |
| Disk pull script overwrites in-progress local edits. | Refuses to write if disk mtime > DB approved_at. Surfaces via `observations`. |
| Two migration trees confusion. | All new migrations in root `supabase/migrations/`. Dashboard tree is read-only history. Plan calls this out explicitly. |

## Out of scope (intentionally)

- Multi-tenant or cross-user permissioning. Single-user system.
- Real-time persona hot-reload mid-session — agents pick up new prompts on next session. Hot-reload is a future plan.
- Migrating the `context` free-text from `agent_memory` (no clean entry boundary). Legacy table stays.
- Updating `delegate` / `route_query` to read from `proposals` instead of `skill_versions` (follow-up plan; dual-write covers this cycle).
- Adding new agents.
- Changing persona content. Today's edits stay as the v1 row.

## Verification commands (paste-ready)

```bash
# Phase 1
psql "$DATABASE_URL" -c "\d agent_personas"
psql "$DATABASE_URL" -c "\d agent_memories"
psql "$DATABASE_URL" -c "\d proposals"
# RLS check (use anon key):
SUPABASE_URL=... ANON_KEY=... node -e "/* fetch agent_personas, expect 0 rows or RLS error */"

# Phase 2
psql "$DATABASE_URL" -c "SELECT agent_id, kind, length(body) FROM agent_personas WHERE status='live' ORDER BY agent_id, kind;"

# Phase 2.5
psql "$DATABASE_URL" -c "SELECT agent_id, type, count(*) FROM agent_memories GROUP BY agent_id, type ORDER BY agent_id;"

# Phase 3
cd /Users/edmundmitchell/factory/dashboard && npm run lint && npm run build
# Live smoke: curl localhost:3000/api/chat with Cordis, confirm system prompt includes memory index header

# Phase 4 (after Edmund approval)
node /Users/edmundmitchell/factory/ops/bin/find-agent-body-readers.mjs   # must be empty

# Phase 5 — end-to-end
# Insert synthetic persona-edit proposal; approve in UI; verify new agent_personas row + new chat session uses it.

# Phase 6
node /Users/edmundmitchell/factory/ops/bin/pull-personas-from-db.mjs --dry-run
node /Users/edmundmitchell/factory/ops/bin/sync-agents.mjs   # must exit 1

# Phase 7
node /Users/edmundmitchell/factory/ops/bin/check-persona-disk-drift.mjs
```

## Paste-ready autonomous-execution prompt

```
Execute /Users/edmundmitchell/factory/ops/plans/2026-05-03-agent-personas-and-memory.md (v2).

Constraints:
- Operate under ops/autonomy-charter.md.
- Run Phases 1, 2, 2.5, 3, 5, 6, 7 in that order. SKIP Phase 4 (drop body columns) — autonomy hard-stop. After Phase 3 verification passes, write a one-paragraph go/no-go memo for Edmund covering the Phase 4 audit results.
- All new migrations land in /Users/edmundmitchell/factory/supabase/migrations/ (root tree). Do not add files to dashboard/supabase/migrations/.
- Use git worktrees per superpowers:using-git-worktrees. Commit after each phase.
- After Phase 5 ships, run the end-to-end smoke test: synthetic persona-edit proposal → approve via /inbox/promotions UI → confirm new agent_personas row + new chat session uses the new prompt. If any step fails twice, surface to Edmund.
- Write a run log to ops/reports/2026-05-03-agent-personas-and-memory-run.md as you go, with one section per phase: what changed, verification output (real, not described), any deviations from the plan, and the next-phase entry condition.
- RLS contract test in Phase 1 is a hard gate. Anon role must NOT be able to read agent_personas.body, agent_memories.body, or proposals.payload. If RLS check passes despite anon access, halt and surface.
- Do NOT delete the factory disk copy at /factory/CEO cowork/agent personalities/. Phase 7 ends with a request for Edmund to do that himself.
- Do NOT change /factory/archive/icloud-ceo-cowork-quarantine-2026-05-03/. Edmund spot-checks it separately.

Then review the work against this plan and verify by running the Phase 5 end-to-end smoke test.
```
