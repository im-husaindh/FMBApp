create table public.portion_options (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('gravy', 'rice', 'roti')),
  label text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  unique (category, label)
);

alter table public.portion_options enable row level security;

create policy portion_options_select on public.portion_options
  for select
  using (auth.uid() is not null);

create policy portion_options_write_super_admin on public.portion_options
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());
