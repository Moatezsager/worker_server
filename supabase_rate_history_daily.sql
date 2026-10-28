-- Apply once in the shared Supabase SQL Editor before deploying the archiver.
begin;
create table if not exists public.rate_history_daily (
  source_table text not null check (source_table in ('parallel_rates', 'official_rates', 'metal_rates')),
  local_date date not null,
  mean_rates jsonb not null,
  low_rates jsonb not null,
  high_rates jsonb not null,
  last_rates jsonb not null,
  weekly_close_rates jsonb,
  observations integer not null check (observations > 0),
  first_at timestamptz not null,
  last_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (source_table, local_date)
);

alter table public.rate_history_daily enable row level security;
revoke all privileges on table public.rate_history_daily from public, anon, authenticated;
grant select, insert, update, delete on table public.rate_history_daily to service_role;

commit;

select c.relrowsecurity as rls_enabled,
  has_table_privilege('anon', 'public.rate_history_daily', 'select') as anon_can_read,
  has_table_privilege('authenticated', 'public.rate_history_daily', 'select') as authenticated_can_read,
  (has_table_privilege('service_role', 'public.rate_history_daily', 'select')
   and has_table_privilege('service_role', 'public.rate_history_daily', 'insert')
   and has_table_privilege('service_role', 'public.rate_history_daily', 'update')
   and has_table_privilege('service_role', 'public.rate_history_daily', 'delete')) as server_has_access
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'rate_history_daily';
