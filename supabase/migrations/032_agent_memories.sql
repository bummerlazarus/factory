-- 032_agent_memories.sql
-- MEMORY.md-style typed curated entries per agent.
-- Coexists with legacy public.agent_memory (kept as-is, marked legacy).
-- Service-role only RLS — entries can contain sensitive personal context.

CREATE TABLE IF NOT EXISTS public.agent_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL REFERENCES public.agents(id) ON UPDATE CASCADE,
  name text NOT NULL,
  description text NOT NULL,
  type text NOT NULL CHECK (type IN ('feedback','project','reference','user')),
  body text NOT NULL,
  version int NOT NULL,
  status text NOT NULL DEFAULT 'live'
    CHECK (status IN ('proposed','approved','live','rejected','superseded')),
  created_by text NOT NULL CHECK (created_by IN ('curator','agent','human')),
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (agent_id, name, version)
);

CREATE INDEX IF NOT EXISTS agent_memories_agent_status_idx
  ON public.agent_memories (agent_id, status);
CREATE INDEX IF NOT EXISTS agent_memories_agent_name_version_idx
  ON public.agent_memories (agent_id, name, version DESC);

ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON public.agent_memories;
CREATE POLICY service_role_all ON public.agent_memories
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

INSERT INTO public.table_registry
  (table_name, domain, layer, purpose, canonical_status,
   safe_for_default_retrieval, query_style, retrieval_notes, owner_intent, last_audited_at)
VALUES
  ('agent_memories', 'agents', 'atlas',
   'MEMORY.md-style typed curated memory entries per agent (feedback/project/reference/user). Replaces free-text agent_memory.',
   'canonical', false, 'sql',
   'Service-role only. Read latest status=live row per (agent_id, name).',
   ARRAY['memory_lookup']::text[], now())
ON CONFLICT (table_name) DO UPDATE SET
  layer=EXCLUDED.layer, purpose=EXCLUDED.purpose,
  canonical_status=EXCLUDED.canonical_status,
  safe_for_default_retrieval=EXCLUDED.safe_for_default_retrieval,
  query_style=EXCLUDED.query_style, retrieval_notes=EXCLUDED.retrieval_notes,
  owner_intent=EXCLUDED.owner_intent, last_audited_at=now();
