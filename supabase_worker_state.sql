-- Run manually in Supabase SQL Editor after reviewing the target project.
-- Intended only for the missing table: if it exists, this transaction fails safely.
begin;

create table public.server_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.server_config enable row level security;
revoke all privileges on table public.server_config from public, anon, authenticated;
grant select, insert, update, delete on table public.server_config to service_role;

comment on table public.server_config is
  'Private Worker checkpoints: WhatsApp authentication, publication queue and runtime settings. Never grant browser roles access.';

notify pgrst, 'reload schema';
commit;

-- Verify permissions without reading or displaying any session contents.
select
  relrowsecurity as rls_enabled,
  has_table_privilege('anon', 'public.server_config', 'SELECT') as anon_can_read,
  has_table_privilege('authenticated', 'public.server_config', 'SELECT') as authenticated_can_read,
  has_table_privilege('service_role', 'public.server_config', 'SELECT') as worker_can_read,
  has_table_privilege('service_role', 'public.server_config', 'INSERT') as worker_can_insert,
  has_table_privilege('service_role', 'public.server_config', 'UPDATE') as worker_can_update
from pg_class
where oid = 'public.server_config'::regclass;
