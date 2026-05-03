# Phase 1 — Cross-Session Search Implementation Plan (revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revised:** 2026-05-03 after code review. Original v1 had two SQL bugs (JSON-quoted FTS source, possibly-invalid generated column) and wrong table choice. This v2 fixes all three.

**Goal:** Add a `session_search` intent so Claude sessions can call `retrieve({intent: 'session_search', query: '...'})` and get back ranked excerpts from past chat conversations with session_id, agent, date, and snippet.

**Architecture:** Trigger-maintained `tsvector` column on `public.agent_conversations`, GIN index, `search_chat_history()` RPC restricted to `service_role`, dispatched server-side by the existing `route_query` Edge Function under a new `session_search` intent. The existing `retrieve` tool in `dashboard/lib/tools.ts` gets `session_search` added to its intent list — no new dashboard tool, no new agent allowlist edits.

**Tech Stack:** Postgres FTS (`english` config), trigger function in `plpgsql`, Supabase RPC, existing `route_query` Deno Edge Function (`x-capture-secret` shared-secret), existing `retrieve` tool.

**Source-of-truth caveat (read before starting):** `public.table_registry` (migration 020) flags `agent_conversations` as `legacy` and `sessions`+`agent_messages` as `canonical`. Reality (verified 2026-05-03): the dashboard still writes to `agent_conversations` (latest row 06:13 today), and `sessions`+`agent_messages` haven't been written since 2026-04-19. Build on `agent_conversations` for now. Task 6 files an `agent_tasks` loose-end ticket to resolve the drift later.

---

## File Map

- **Create:** `supabase/migrations/027_session_search_fts.sql` — column, trigger, GIN index, backfill, RPC, intent_router seed, rollback comment.
- **Modify:** `supabase/functions/route_query/index.ts` — add `session_search` case to dispatch switch + update top-of-file doc comment.
- **Modify:** `dashboard/lib/tools.ts` lines 489–528 — append `session_search` to the `retrieve` tool's intent list (description + input_schema).
- **Append:** `ops/changelog.md` — entry for Phase 1.
- **Insert:** one row into `public.agent_tasks` with `[loose-end]` prefix per `ops/docs/loose-ends.md`.

---

## Task 1: Migration 027 — column, trigger, index, RPC, intent

**Files:**
- Create: `supabase/migrations/027_session_search_fts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/027_session_search_fts.sql
-- Phase 1 — Cross-Session Search.
--
-- Adds a trigger-maintained tsvector column over agent_conversations.messages
-- (JSONB chat transcripts) and a SECURITY DEFINER RPC search_chat_history()
-- restricted to service_role. route_query() dispatches a new `session_search`
-- intent here.
--
-- Why agent_conversations and not the registry-canonical sessions+agent_messages?
-- Verified 2026-05-03: registry-canonical tables are stale since 2026-04-19;
-- agent_conversations is where current dashboard chats actually land.
-- Loose-end ticket filed in agent_tasks to resolve the drift.
--
-- Rollback (run in psql if needed):
--   DROP TRIGGER IF EXISTS trg_agent_conversations_fts_refresh ON public.agent_conversations;
--   DROP FUNCTION IF EXISTS public.agent_conversations_fts_refresh();
--   DROP INDEX IF EXISTS public.agent_conversations_messages_fts_idx;
--   ALTER TABLE public.agent_conversations DROP COLUMN IF EXISTS messages_fts;
--   DROP FUNCTION IF EXISTS public.search_chat_history(text, integer, text, timestamptz);
--   DELETE FROM public.intent_router WHERE intent = 'session_search';

BEGIN;

-- 1. Plain tsvector column (NOT generated — generated cols can't use
--    set-returning functions like jsonb_array_elements).
ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS messages_fts tsvector;

-- 2. Trigger function: extracts text from messages JSONB array properly,
--    so FTS sees clean words instead of JSON-quoted blobs with backslashes.
CREATE OR REPLACE FUNCTION public.agent_conversations_fts_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.messages_fts := to_tsvector(
    'english',
    coalesce(NEW.title, '') || ' ' ||
    coalesce(
      (SELECT string_agg(elem->>'content', ' ')
       FROM jsonb_array_elements(NEW.messages) AS elem
       WHERE elem ? 'content'),
      ''
    )
  );
  RETURN NEW;
END$$;

-- 3. Trigger fires on INSERT or when title/messages change.
DROP TRIGGER IF EXISTS trg_agent_conversations_fts_refresh ON public.agent_conversations;
CREATE TRIGGER trg_agent_conversations_fts_refresh
  BEFORE INSERT OR UPDATE OF title, messages
  ON public.agent_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_conversations_fts_refresh();

-- 4. Backfill existing rows by no-op-updating them (fires the trigger).
UPDATE public.agent_conversations SET title = title;

-- 5. GIN index for fast search.
CREATE INDEX IF NOT EXISTS agent_conversations_messages_fts_idx
  ON public.agent_conversations USING gin (messages_fts);

-- 6. RPC. SECURITY DEFINER so route_query (running as service_role) can call
--    it consistently. Granted ONLY to service_role — never anon/authenticated,
--    because session content can include private brainstorming.
CREATE OR REPLACE FUNCTION public.search_chat_history(
  q text,
  top_k integer DEFAULT 10,
  agent_filter text DEFAULT NULL,
  since timestamptz DEFAULT NULL
)
RETURNS TABLE (
  session_id text,
  persona_id text,
  title text,
  updated_at timestamptz,
  rank real,
  excerpt text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q_ts AS (SELECT websearch_to_tsquery('english', q) AS tsq),
  text_src AS (
    SELECT
      c.session_id,
      c.persona_id,
      c.title,
      c.updated_at,
      c.messages_fts,
      coalesce(
        (SELECT string_agg(elem->>'content', ' ')
         FROM jsonb_array_elements(c.messages) AS elem
         WHERE elem ? 'content'),
        ''
      ) AS body_text,
      coalesce(c.status, 'active') AS status
    FROM public.agent_conversations c
  )
  SELECT
    t.session_id,
    t.persona_id,
    t.title,
    t.updated_at,
    ts_rank(t.messages_fts, (SELECT tsq FROM q_ts)) AS rank,
    ts_headline(
      'english',
      t.body_text,
      (SELECT tsq FROM q_ts),
      'MaxFragments=2,MaxWords=25,MinWords=8,ShortWord=3'
    ) AS excerpt
  FROM text_src t
  WHERE t.messages_fts @@ (SELECT tsq FROM q_ts)
    AND (agent_filter IS NULL OR t.persona_id = agent_filter)
    AND (since IS NULL OR t.updated_at >= since)
    AND t.status <> 'deleted'
  ORDER BY rank DESC, t.updated_at DESC
  LIMIT greatest(1, least(top_k, 50));
$$;

REVOKE ALL ON FUNCTION public.search_chat_history(text, integer, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_chat_history(text, integer, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_chat_history(text, integer, text, timestamptz) TO service_role;

-- 7. intent_router seed. required_filters left null (dispatch is hardcoded in
--    route_query, matching the match_memory pattern — don't overload this column).
INSERT INTO public.intent_router (
  intent, description, primary_tables, secondary_tables, forbidden_tables,
  query_style, required_filters, default_limit, notes
) VALUES (
  'session_search',
  'Search past Claude chat sessions by keyword/phrase. Returns ranked excerpts.',
  ARRAY['agent_conversations'],
  NULL,
  NULL,
  'sql',
  NULL,
  10,
  'Dispatched server-side by route_query to public.search_chat_history(q, top_k, agent_filter, since). FTS only.'
)
ON CONFLICT (intent) DO UPDATE SET
  description = EXCLUDED.description,
  primary_tables = EXCLUDED.primary_tables,
  query_style = EXCLUDED.query_style,
  default_limit = EXCLUDED.default_limit,
  notes = EXCLUDED.notes;

COMMIT;
```

- [ ] **Step 2: Apply the migration**

Use Supabase MCP `apply_migration` with `project_id='obizmgugsqirmnjpirnh'`, name `'027_session_search_fts'`, query = file contents.

Expected: success.

If failure: read the error. The most likely issue is `messages` containing rows where it's not a JSON array (would break `jsonb_array_elements`). Check with:
```sql
SELECT count(*) FROM public.agent_conversations
WHERE messages IS NOT NULL AND jsonb_typeof(messages) <> 'array';
```
If >0, wrap the inner SELECT with `WHERE jsonb_typeof(NEW.messages) = 'array'`.

- [ ] **Step 3: Verify trigger and backfill worked**

```sql
SELECT count(*) AS total,
       count(messages_fts) AS indexed,
       count(*) FILTER (WHERE messages_fts IS NULL) AS unindexed
FROM public.agent_conversations;
```
Expected: `indexed = total` (or close — rows with `messages = NULL` will have a non-null but empty tsvector).

- [ ] **Step 4: Smoke-test the RPC with a known query**

```sql
-- Pick a word you know exists in past chats
SELECT session_id, persona_id, rank, excerpt
FROM public.search_chat_history('inbox', 5);
```
Expected: ≥1 row with a meaningful excerpt (NO embedded JSON quotes/brackets).

- [ ] **Step 5: Verify permissions**

```sql
-- Should fail (anon cannot call)
SET ROLE anon;
SELECT * FROM public.search_chat_history('test', 1);
RESET ROLE;
```
Expected: `permission denied for function search_chat_history`.

```sql
-- Should succeed
SET ROLE service_role;
SELECT count(*) FROM public.search_chat_history('test', 1);
RESET ROLE;
```
Expected: returns a count without error.

- [ ] **Step 6: Performance check**

```sql
EXPLAIN ANALYZE
SELECT * FROM public.search_chat_history('inbox', 10);
```
Expected: GIN index used; total time <500ms on the current ~25-row corpus.

- [ ] **Step 7: Commit**

```bash
cd /Users/edmundmitchell/factory
git add supabase/migrations/027_session_search_fts.sql
git commit -m "feat(search): cross-session FTS — trigger-maintained tsvector + service_role RPC"
```

---

## Task 2: Wire `session_search` dispatch into `route_query`

**Files:**
- Modify: `supabase/functions/route_query/index.ts`

- [ ] **Step 1: Read the current dispatch shape**

Open `supabase/functions/route_query/index.ts`. Find the dispatch switch (the v2 server-side execution block — function comment at the top lists the intents it handles). Note the exact shape of how `match_memory` is dispatched — that's the closest precedent (RPC call + return shape).

- [ ] **Step 2: Add the `session_search` case**

Add a case matching the existing pattern (read the file first to copy the exact return-shape convention used by other intents). The case body:

```typescript
case "session_search": {
  if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
    return badRequest("session_search requires a non-empty 'query' string");
  }
  const { data, error } = await supabase.rpc("search_chat_history", {
    q: body.query,
    top_k: typeof body.top_k === "number" ? body.top_k : 10,
    agent_filter: typeof body.agent_filter === "string" ? body.agent_filter : null,
    since: typeof body.since === "string" ? body.since : null,
  });
  if (error) {
    return new Response(
      JSON.stringify({ plan, error: error.message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(
    JSON.stringify({ plan, results: data ?? [] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
```

Also: add `session_search` to the file's top-of-file doc comment under "v2 executes server-side too." Keep the same comment style.

- [ ] **Step 3: Deploy the Edge Function**

Use Supabase MCP `deploy_edge_function` with `project_id='obizmgugsqirmnjpirnh'`, slug `'route_query'`, with the updated `index.ts` contents.

- [ ] **Step 4: Smoke-test end-to-end via curl**

```bash
# Load CAPTURE_SECRET from wherever Edmund keeps it (probably ops/.env or 1Password)
export CAPTURE_SECRET="<from secrets>"
curl -sS -X POST "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/route_query" \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -H "content-type: application/json" \
  -d '{"intent":"session_search","query":"inbox","top_k":3}' | jq .
```
Expected: `{"plan": {...}, "results": [...]}` — non-empty results array, no `error` key.

- [ ] **Step 5: Test the unauthorized path**

```bash
curl -sS -X POST "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/route_query" \
  -H "x-capture-secret: WRONG" \
  -H "content-type: application/json" \
  -d '{"intent":"session_search","query":"inbox"}' | jq .
```
Expected: `{"error":"unauthorized"}` with HTTP 401.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/route_query/index.ts
git commit -m "feat(route_query): dispatch session_search intent to search_chat_history RPC"
```

---

## Task 3: Add `session_search` to the `retrieve` tool's intent list

**Files:**
- Modify: `dashboard/lib/tools.ts` lines 489–528

- [ ] **Step 1: Read the current `retrieve` tool definition**

```bash
sed -n '489,530p' /Users/edmundmitchell/factory/dashboard/lib/tools.ts
```

- [ ] **Step 2: Edit the description string** (line ~493)

The current description ends with the intent list. Add `session_search` to that list. The exact change:

In the multi-line description, find the line:
```
"Intents: `recent_activity` (work_log, sessions), ... `workflow_planning` (skills + scheduled tasks)."
```
Append `, `session_search` (past chat conversations by keyword)` immediately before the closing period.

- [ ] **Step 3: Edit the input_schema's `intent` description** (line ~501–504)

The current text is:
```
"Intent label — must be one of: recent_activity, project_status, concept_lookup, memory_lookup, research_question, content_idea_lookup, content_performance, business_lookup, ingestion_status, agent_debugging, workflow_planning."
```
Change to add `, session_search` before the closing period.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/edmundmitchell/factory/dashboard && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors. (Pure string change should not affect types.)

- [ ] **Step 5: Smoke-test from the dashboard chat UI**

`localhost:3000` is already running via launchd. Open a chat with any agent that has the `retrieve` tool (Cordis qualifies — verify in `groupsForAgent` if unsure). Ask: *"Use retrieve with intent session_search and query 'inbox' to find past discussions."*

Expected: tool call fires, results render. If the agent doesn't pick `session_search` automatically from a natural prompt, that's fine for v1 — explicit tool invocation works.

- [ ] **Step 6: Commit**

```bash
cd /Users/edmundmitchell/factory/dashboard
git add lib/tools.ts
git commit -m "feat(tools): add session_search to retrieve tool's intent list"
```

The dashboard is running under launchd with HMR; the change picks up automatically. No restart needed.

---

## Task 4: File the loose-end ticket about table-registry drift

**Action:** Insert one row into `public.agent_tasks` per `ops/docs/loose-ends.md`.

- [ ] **Step 1: Run the insert**

Use Supabase MCP `execute_sql`:
```sql
INSERT INTO public.agent_tasks (
  id, from_agent, from_name, from_emoji, to_agent,
  title, description, status, priority, project_slug
) VALUES (
  gen_random_uuid()::text,
  'claude-code', 'Claude Code', '🤖',
  'edmund',
  '[loose-end] table_registry says agent_conversations is legacy but it is the only table actively written',
  'Verified 2026-05-03 during Phase 1 build: public.sessions and public.agent_messages have no writes since 2026-04-19, while public.agent_conversations was written today. Migration 020 marks the live one ''legacy'' and the dead ones ''canonical''. Phase 1 cross-session search built on agent_conversations to match reality. Resolve by either (a) migrating dashboard session writes to sessions+agent_messages and reflagging registry, or (b) updating registry to reflect agent_conversations as canonical and the others as deprecated. Affects: dashboard/lib/sessions.ts (write path), supabase/migrations/020_table_registry.sql (registry rows 59/64/110), supabase/functions/route_query (recent_activity intent uses sessions table).',
  'pending', 4, 'factory'
);
```

- [ ] **Step 2: Verify it landed**

```sql
SELECT id, title, priority FROM public.agent_tasks
WHERE title LIKE '[loose-end]%registry%' AND status = 'pending'
ORDER BY created_at DESC LIMIT 1;
```
Expected: 1 row.

---

## Task 5: Document and verify

**Files:**
- Append: `ops/changelog.md`

- [ ] **Step 1: Append changelog entry**

Create the file if absent (`test -f ops/changelog.md || printf '# Factory changelog\n\n' > ops/changelog.md`). Then prepend (after the heading):

```markdown
## 2026-05-03 — Phase 1: cross-session search

- Migration 027 adds `agent_conversations.messages_fts` (trigger-maintained tsvector + GIN index), `search_chat_history()` RPC restricted to `service_role`, and a `session_search` row in `intent_router`.
- `route_query` dispatches `session_search` server-side.
- `retrieve` tool's intent list extended with `session_search` (no new tool).
- Built on `agent_conversations` (registry says legacy, but it is the only chat table being actively written — drift filed as loose-end ticket in `agent_tasks`).
- Try it: in any chat, `retrieve({intent: 'session_search', query: '<keyword>'})`.
- Plan: `ops/plans/2026-05-03-phase-1-cross-session-search.md`. Roadmap: `ops/plans/2026-05-03-hermes-inspired-roadmap.md`.
```

- [ ] **Step 2: Verify all roadmap success criteria**

- [ ] `retrieve({intent: 'session_search', query: '<known-word>'})` from a Claude chat returns ≥1 ranked excerpt with session_id, persona_id, updated_at, rank, excerpt.
- [ ] `EXPLAIN ANALYZE` shows GIN index used and total time <500ms on the current corpus.
- [ ] `route_query/index.ts` doc comment lists `session_search`.
- [ ] `dashboard/lib/tools.ts`'s `retrieve` tool description and input_schema both list `session_search`.
- [ ] `agent_tasks` has the registry-drift loose-end row.

- [ ] **Step 3: Commit**

```bash
cd /Users/edmundmitchell/factory
git add ops/changelog.md
git commit -m "docs: changelog entry for Phase 1 cross-session search"
```

- [ ] **Step 4: Report to Edmund**

Tell Edmund:
- Phase 1 done; smoke test output.
- One example query + result so he can see what it looks like.
- The loose-end ticket about registry drift (so he knows there's an open question for Phase 2 to resolve or push back on).
- Ask: proceed to Phase 2 (Curator nudges) plan, or pause?

---

## Self-Review Notes

**Spec coverage** — every roadmap success criterion maps to a verification step in Task 5 step 2.

**Type consistency** — RPC params (`q`, `top_k`, `agent_filter`, `since`) match between SQL definition (Task 1), dispatch case body (Task 2), and `retrieve` tool's existing input_schema (which already accepts `query` mapped to `q` via the route_query body). Tool name is `retrieve` throughout — no new tool name introduced.

**Placeholder scan** — `<from secrets>` in Task 2 step 4 (CAPTURE_SECRET) is intentional; Edmund or the executing agent fetches it from the secrets store. Marked clearly. No other placeholders.

**Reviewer fixes confirmed:**
- ✅ Trigger-maintained tsvector (not generated column).
- ✅ Clean text extraction via `jsonb_array_elements` + `string_agg(... ->>'content')` — no JSON quotes/brackets in FTS source.
- ✅ Granted to `service_role` only; explicitly revoked from `anon`/`authenticated`.
- ✅ Built on actually-written table (`agent_conversations`); registry drift filed as `agent_tasks` row.
- ✅ Reuses existing `retrieve` tool — no new dashboard tool, no agent allowlist edits.
- ✅ Renamed RPC to `search_chat_history` (avoids collision with `public.sessions` table noun).
- ✅ Did not overload `intent_router.required_filters` for dispatch — left null, dispatch hardcoded in `route_query`.
- ✅ Rollback comment block in the migration.
- ✅ Performance verified by `EXPLAIN ANALYZE` step.
