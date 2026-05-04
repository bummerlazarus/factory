-- 038_workspace_items_spec_type.sql
-- 1) Allow 'spec' as a workspace_items.type value.
-- 2) Register 4 spec artifact kinds in reference_docs_kinds (FK target).
--
-- A Spec is a planning artifact with 4 child reference_docs (proposal/scenarios/design/tasks)
-- and N child workspace_items rows of type='task' linked via project_id (which stores parent slug).

alter table public.workspace_items drop constraint if exists workspace_items_type_check;
alter table public.workspace_items add constraint workspace_items_type_check
  check (type in ('plan','project','task','scope','spec'));

comment on column public.workspace_items.type is
  'plan | project | task | scope | spec. Specs are planning artifacts with 4 reference_docs children.';

insert into public.reference_docs_kinds (kind) values
  ('spec_proposal'),
  ('spec_scenarios'),
  ('spec_design'),
  ('spec_tasks')
on conflict (kind) do nothing;
