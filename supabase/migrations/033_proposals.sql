-- 033_proposals.sql
-- Generalized envelope/inbox for human-approval proposals.
-- kinds: 'skill' (existing curator output) | 'persona-edit' | 'memory-entry'.
-- On approval, payload is materialized to its target table (skill_versions /
-- agent_personas / agent_memories) and proposals.status flips to 'live'.
-- Service-role only RLS — payloads can include full system prompts.

CREATE TABLE IF NOT EXISTS public.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('skill','persona-edit','memory-entry')),
  target_agent_id text REFERENCES public.agents(id) ON UPDATE CASCADE,
  target_skill_name text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','live','rejected','superseded')),
  rationale text,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by text,
  materialized_at timestamptz,
  materialized_target_id uuid
);

CREATE INDEX IF NOT EXISTS proposals_status_proposed_at_idx
  ON public.proposals (status, proposed_at DESC);
CREATE INDEX IF NOT EXISTS proposals_kind_status_idx
  ON public.proposals (kind, status);
CREATE INDEX IF NOT EXISTS proposals_target_agent_status_idx
  ON public.proposals (target_agent_id, status);

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON public.proposals;
CREATE POLICY service_role_all ON public.proposals
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

INSERT INTO public.table_registry
  (table_name, domain, layer, purpose, canonical_status,
   safe_for_default_retrieval, query_style, retrieval_notes, owner_intent, last_audited_at)
VALUES
  ('proposals', 'workflow', 'atlas',
   'Generalized human-approval inbox. Curator writes here; /inbox/promotions approves; materialized to target tables.',
   'canonical', false, 'sql',
   'Service-role only. Read status=proposed for inbox; status=live after materialization.',
   ARRAY['workflow_planning']::text[], now())
ON CONFLICT (table_name) DO UPDATE SET
  layer=EXCLUDED.layer, purpose=EXCLUDED.purpose,
  canonical_status=EXCLUDED.canonical_status,
  safe_for_default_retrieval=EXCLUDED.safe_for_default_retrieval,
  query_style=EXCLUDED.query_style, retrieval_notes=EXCLUDED.retrieval_notes,
  owner_intent=EXCLUDED.owner_intent, last_audited_at=now();
