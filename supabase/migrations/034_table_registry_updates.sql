-- 034_table_registry_updates.sql
-- Ensure agent_memory is explicitly marked legacy with a clear deprecation note.

UPDATE public.table_registry
SET canonical_status = 'legacy',
    purpose = COALESCE(purpose,'') ||
              CASE WHEN purpose ILIKE '%superseded%' THEN ''
                   ELSE ' Superseded by public.agent_memories (2026-05-03).' END,
    last_audited_at = now()
WHERE table_name = 'agent_memory';
