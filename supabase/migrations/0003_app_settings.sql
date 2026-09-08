create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy app_settings_select on public.app_settings
  for select
  using (auth.uid() is not null);

create policy app_settings_write_super_admin on public.app_settings
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());
