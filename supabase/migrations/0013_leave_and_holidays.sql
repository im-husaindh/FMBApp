create table public.user_leaves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  reason text,
  entered_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index user_leaves_user_id_idx on public.user_leaves(user_id);
create index user_leaves_date_range_idx on public.user_leaves(from_date, to_date);

create table public.service_holidays (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  reason text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.user_leaves enable row level security;
alter table public.service_holidays enable row level security;
