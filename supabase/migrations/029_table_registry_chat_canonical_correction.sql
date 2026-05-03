-- Resolve loose-end 4e4d863f-4a39-4dc3-b14b-dd7d30a815f7 (filed Phase 1, 2026-05-03).
--
-- Reality check: dashboard/lib/sessions.ts writes to agent_conversations.
-- The previous registry marked it `legacy` and pointed `recent_activity` at
-- public.sessions, but sessions hasn't been written since 2026-04-19. This
-- left route_query plans returning empty primary_tables for session_search.
--
-- Codify reality: agent_conversations is canonical for chat content; sessions
-- + agent_messages move to supporting (still queryable for historical data).
--
-- Applied via Supabase MCP on 2026-05-03; this file is the canonical record.

UPDATE public.table_registry
SET canonical_status = 'canonical',
    owner_intent = ARRAY['session_search']::text[],
    purpose = 'raw',
    retrieval_notes = 'Chat conversations: per-session messages JSONB. Live write target from dashboard/lib/sessions.ts. FTS-indexed via migration 027.'
WHERE table_name = 'agent_conversations';

UPDATE public.table_registry
SET canonical_status = 'supporting',
    retrieval_notes = 'Historical chat sessions (writes ceased 2026-04-19; agent_conversations is live target). Retained for older session_id lookups.'
WHERE table_name = 'sessions';

UPDATE public.table_registry
SET retrieval_notes = 'Historical per-message rows (writes ceased 2026-04-18; agent_conversations.messages JSONB is live target).'
WHERE table_name = 'agent_messages';

UPDATE public.agent_tasks
SET status = 'approved',
    completed_at = now(),
    result = 'Resolved via migration 029: agent_conversations is now canonical in table_registry, sessions+agent_messages marked supporting/historical. route_query plans now return non-empty primary_tables for session_search.'
WHERE id = '4e4d863f-4a39-4dc3-b14b-dd7d30a815f7';
