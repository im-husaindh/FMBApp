create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  previous_state jsonb,
  new_state jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);
create index audit_logs_created_at_idx on public.audit_logs(created_at);

alter table public.audit_logs enable row level security;

create policy audit_logs_select_super_admin on public.audit_logs
  for select
  using (public.is_super_admin());

-- Deliberately no insert/update/delete policy for any role: rows are
-- written only by SECURITY DEFINER functions (added in later phases)
-- running as the table owner, never via a direct client grant.
