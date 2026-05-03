-- 031_agent_personas.sql
-- Versioned per-agent prompt parts (identity / claude / soul markdown).
-- Source of truth replaces the markdown body columns on public.agents.
-- Service-role only RLS — these bodies contain full system prompts.

CREATE TABLE IF NOT EXISTS public.agent_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL REFERENCES public.agents(id) ON UPDATE CASCADE,
  kind text NOT NULL CHECK (kind IN ('identity','claude','soul')),
  version int NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','live','rejected','superseded')),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by text,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  canonical_disk_path text,
  UNIQUE (agent_id, kind, version)
);

CREATE INDEX IF NOT EXISTS agent_personas_agent_kind_status_idx
  ON public.agent_personas (agent_id, kind, status);
CREATE INDEX IF NOT EXISTS agent_personas_status_approved_at_idx
  ON public.agent_personas (status, approved_at DESC);

ALTER TABLE public.agent_personas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON public.agent_personas;
CREATE POLICY service_role_all ON public.agent_personas
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

INSERT INTO public.table_registry
  (table_name, domain, layer, purpose, canonical_status,
   safe_for_default_retrieval, query_style, retrieval_notes, owner_intent, last_audited_at)
VALUES
  ('agent_personas', 'agents', 'atlas',
   'Versioned per-agent prompt parts (identity/claude/soul). Source of truth for agent system prompts.',
   'canonical', false, 'sql',
   'Service-role only. Read latest status=live row per (agent_id, kind).',
   ARRAY['agent_debugging']::text[], now())
ON CONFLICT (table_name) DO UPDATE SET
  layer=EXCLUDED.layer, purpose=EXCLUDED.purpose,
  canonical_status=EXCLUDED.canonical_status,
  safe_for_default_retrieval=EXCLUDED.safe_for_default_retrieval,
  query_style=EXCLUDED.query_style, retrieval_notes=EXCLUDED.retrieval_notes,
  owner_intent=EXCLUDED.owner_intent, last_audited_at=now();
