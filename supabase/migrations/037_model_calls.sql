-- 037_model_calls.sql
-- Per-LLM-response usage + estimated cost. One row per provider response
-- (i.e. one row per messages.create or chat/completions call). Used to
-- estimate weekly spend and spot expensive workflows.

create table if not exists public.model_calls (
  id              bigserial primary key,
  ts              timestamptz not null default now(),
  source          text        not null,
  model           text        not null,
  provider        text        not null,
  input_tokens         integer not null default 0,
  output_tokens        integer not null default 0,
  cache_read_tokens    integer not null default 0,
  cache_write_tokens   integer not null default 0,
  est_cost_usd    numeric(12,6) not null default 0,
  agent_id        text,
  tool            text,
  latency_ms      integer,
  metadata        jsonb       not null default '{}'::jsonb
);

create index if not exists model_calls_ts_idx       on public.model_calls (ts desc);
create index if not exists model_calls_source_ts_idx on public.model_calls (source, ts desc);
create index if not exists model_calls_agent_ts_idx on public.model_calls (agent_id, ts desc) where agent_id is not null;

alter table public.model_calls enable row level security;

create policy "service_role full access"
  on public.model_calls
  for all
  to service_role
  using (true) with check (true);

create or replace view public.model_calls_daily as
  select
    date_trunc('day', ts)::date as day,
    source,
    sum(input_tokens)        as input_tokens,
    sum(output_tokens)       as output_tokens,
    sum(cache_read_tokens)   as cache_read_tokens,
    sum(cache_write_tokens)  as cache_write_tokens,
    sum(est_cost_usd)        as est_cost_usd,
    count(*)                 as call_count
  from public.model_calls
  where ts > now() - interval '30 days'
  group by 1, 2;

grant select on public.model_calls_daily to anon, authenticated;
