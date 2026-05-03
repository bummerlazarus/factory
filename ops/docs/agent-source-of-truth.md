# Agent definitions — source of truth

**Date:** 2026-05-03 (rewritten — see history at the bottom)
**Status:** Active convention. Read before editing any agent.

## TL;DR

- **Supabase `public.agent_personas` = source of truth** for the markdown bodies (identity, CLAUDE.md, soul) per agent.
- **Supabase `public.agents` = roster** (id, name, role, emoji, accent_color, domain_keywords, tool_tags, sort_order, archived). Body columns there are kept as a transition fallback only and will be dropped after Phase 4 of [`ops/plans/2026-05-03-agent-personas-and-memory.md`](../plans/2026-05-03-agent-personas-and-memory.md).
- **Edits go through `/inbox/promotions`.** A `kind='persona-edit'` proposal is created (by curator or by hand); on approve it materializes a new `agent_personas` row at the next version, supersedes the prior live row, and the dashboard picks it up on the next request.
- **Disk is downstream/optional.** Use the pull script when you need files locally for Cowork-style editing flows.

## Doing things

### Editing an agent's identity / CLAUDE.md / soul

1. Don't touch disk. Don't touch `public.agents` rows.
2. Insert a row into `public.proposals`:
   ```sql
   INSERT INTO public.proposals (kind, target_agent_id, payload, rationale)
   VALUES (
     'persona-edit',
     '<agent_id>',
     jsonb_build_object('agent_id','<agent_id>','kind','identity','body','<full new body>'),
     'why this change'
   );
   ```
   (The curator emits these automatically when its persona-proposal flag is enabled. Default off; manual inserts work today.)
3. Approve via `/inbox/promotions` on the dashboard. The new prompt is live the next time any agent loads.

### Pulling DB → disk

Use when Cowork or another disk-based workflow needs current files:
```bash
node ops/bin/pull-personas-from-db.mjs --dry-run     # preview
node ops/bin/pull-personas-from-db.mjs               # write
```
Refuses to overwrite a file whose mtime is newer than the corresponding DB `approved_at` — it logs an `observations` row tagged `metadata.drift_type='persona_drift'` and exits 2. Resolve by reviewing the disk edits and either proposing them as a `persona-edit` or deleting the local file.

### Adding a new agent

Out of scope for the persona/memory plan. Add the roster row to `public.agents` first, then seed the three personas via direct insert (one-time migration) or the proposal flow.

### Curated agent memory

Per-agent `MEMORY.md`-style entries live in `public.agent_memories`. The dashboard injects an index of `(name, type, description)` into the system prompt; full bodies are fetched on demand via the `read_agent_memory(name)` tool. Writing entries also goes through `/inbox/promotions` (proposal `kind='memory-entry'`). Legacy `public.agent_memory` (3 free-text files per agent) is marked `canonical_status='legacy'` in `table_registry`.

## Don't

- ❌ Run `node ops/bin/sync-agents.mjs` — it now exits 1 with the deprecation message.
- ❌ Run the disk→DB push from `dashboard/scripts/import-agents-from-icloud.mjs` — historical one-shot import; superseded by Phase 1 of the personas plan.
- ❌ UPDATE `public.agents.identity_md` / `claude_md` / `soul_md` directly. The runtime read path no longer reads them when an `agent_personas` row exists.

## Why this changed

Original convention (April 2026 → early May 2026): disk was source of truth, `sync-agents.mjs` pushed disk → DB, runtime cached the DB row. Two failure modes drove the rewrite:

1. **iCloud-vs-factory drift.** A Claude session edited the wrong copy on disk and the dashboard kept serving stale prompts for hours.
2. **No self-improving loop.** Every other artifact (skills, memory) had a curator + approval flow. Personas didn't, so stale references survived for weeks (Axel still pointed at "gravityclaw" a month after the rebuild).

Phases 1–3 of [`ops/plans/2026-05-03-agent-personas-and-memory.md`](../plans/2026-05-03-agent-personas-and-memory.md) inverted the direction: DB is source, edits go through proposals, disk is a downstream artifact you pull when you need it.

## History

- **2026-05-03 (now):** Rewritten. Source of truth = `agent_personas`. `sync-agents.mjs` deprecated (original preserved at `ops/bin/sync-agents.mjs.deprecated-2026-05-03`). New `pull-personas-from-db.mjs`.
- **2026-05-03 (earlier same day):** Documented the original disk→DB convention after the iCloud drift incident.
- **April 2026:** Implicit "agents load from COWORK_PATH at request time" convention; mostly true but stale by the time the DB-backed agents path shipped.
