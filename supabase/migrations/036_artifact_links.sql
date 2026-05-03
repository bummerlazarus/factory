-- 036_artifact_links.sql
-- Cross-link workspace_items (projects/tasks/plans/scopes) to artifacts.
-- One link row points at exactly one target: a reference_docs row OR a disk path.
-- Reads/writes go through API routes using the service-role client; no anon policies.

create table if not exists public.artifact_links (
  id uuid primary key default gen_random_uuid(),
  workspace_item_id uuid not null references public.workspace_items(id) on delete cascade,
  reference_doc_id uuid references public.reference_docs(id) on delete cascade,
  disk_path text,
  created_at timestamptz not null default now(),
  created_by text,
  constraint artifact_links_one_target check (
    (reference_doc_id is not null)::int + (disk_path is not null)::int = 1
  )
);

create unique index if not exists artifact_links_unique_ref
  on public.artifact_links (workspace_item_id, reference_doc_id)
  where reference_doc_id is not null;

create unique index if not exists artifact_links_unique_path
  on public.artifact_links (workspace_item_id, disk_path)
  where disk_path is not null;

create index if not exists artifact_links_reference_doc_idx
  on public.artifact_links (reference_doc_id) where reference_doc_id is not null;

create index if not exists artifact_links_disk_path_idx
  on public.artifact_links (disk_path) where disk_path is not null;

alter table public.artifact_links enable row level security;

comment on table public.artifact_links is
  'Links workspace_items (projects/tasks/plans/scopes) to artifacts they produced or consume. Exactly one target column is set per row. Reads/writes go through API routes using the service-role client; no anon policies.';
