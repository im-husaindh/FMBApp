create table public.concerns (
  id uuid primary key default gen_random_uuid(),
  concern_number bigint generated always as identity,
  user_id uuid not null references public.profiles(id),
  concern_date date not null,
  category text not null check (category in ('taste','quality','quantity','packaging','missing_item','menu','other')),
  message text not null,
  attachment_url text,
  status text not null default 'open' check (status in ('open','reviewing','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index concerns_user_id_idx on public.concerns(user_id);
create index concerns_status_idx on public.concerns(status);
create unique index concerns_concern_number_idx on public.concerns(concern_number);

create table public.concern_updates (
  id uuid primary key default gen_random_uuid(),
  concern_id uuid not null references public.concerns(id),
  new_status text check (new_status in ('open','reviewing','resolved','closed')),
  message text,
  changed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint concern_updates_has_content check (new_status is not null or message is not null)
);
create index concern_updates_concern_id_idx on public.concern_updates(concern_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id),
  type text not null check (type in ('concern_response','concern_resolved')),
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_unread_idx on public.notifications(recipient_id) where read_at is null;

alter table public.concerns enable row level security;
alter table public.concern_updates enable row level security;
alter table public.notifications enable row level security;
