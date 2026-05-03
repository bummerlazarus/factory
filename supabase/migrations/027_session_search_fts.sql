-- Phase 1 — Cross-Session Search.
-- Trigger-maintained tsvector over agent_conversations.messages (JSONB chat
-- transcripts) + SECURITY DEFINER RPC search_chat_history() restricted to
-- service_role. route_query() dispatches a new `session_search` intent here.
--
-- agent_conversations is the live table (registry-canonical sessions+
-- agent_messages have not been written since 2026-04-19; loose-end ticket
-- 4e4d863f-4a39-4dc3-b14b-dd7d30a815f7 filed in agent_tasks).
--
-- Applied via Supabase MCP on 2026-05-03; this file is the canonical record.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_agent_conversations_fts_refresh ON public.agent_conversations;
--   DROP FUNCTION IF EXISTS public.agent_conversations_fts_refresh();
--   DROP INDEX IF EXISTS public.agent_conversations_messages_fts_idx;
--   ALTER TABLE public.agent_conversations DROP COLUMN IF EXISTS messages_fts;
--   DROP FUNCTION IF EXISTS public.search_chat_history(text, integer, text, timestamptz);
--   DELETE FROM public.intent_router WHERE intent = 'session_search';

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS messages_fts tsvector;

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

DROP TRIGGER IF EXISTS trg_agent_conversations_fts_refresh ON public.agent_conversations;
CREATE TRIGGER trg_agent_conversations_fts_refresh
  BEFORE INSERT OR UPDATE OF title, messages
  ON public.agent_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_conversations_fts_refresh();

UPDATE public.agent_conversations SET title = title;

CREATE INDEX IF NOT EXISTS agent_conversations_messages_fts_idx
  ON public.agent_conversations USING gin (messages_fts);

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
