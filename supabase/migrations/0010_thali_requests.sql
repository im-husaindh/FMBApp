create table public.thali_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  service_date date not null,
  wants_thali boolean not null,
  gravy_portion_id uuid references public.portion_options(id),
  rice_portion_id uuid references public.portion_options(id),
  roti_quantity int,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  source text not null default 'web',
  created_at timestamptz not null default now(),
  unique (user_id, service_date),
  constraint thali_requests_portions_match_wants check (
    (wants_thali = true
      and gravy_portion_id is not null
      and rice_portion_id is not null
      and roti_quantity is not null)
    or
    (wants_thali = false
      and gravy_portion_id is null
      and rice_portion_id is null
      and roti_quantity is null)
  )
);

create index thali_requests_service_date_idx on public.thali_requests(service_date);
create index thali_requests_user_id_idx on public.thali_requests(user_id);

alter table public.thali_requests enable row level security;
