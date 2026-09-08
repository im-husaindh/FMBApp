create table public.menus (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  current_approved_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.menu_version_status as enum (
  'draft', 'pending_approval', 'approved', 'rejected', 'superseded'
);

create table public.menu_versions (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.menus(id) on delete cascade,
  version_number int not null,
  title text,
  notes text,
  status public.menu_version_status not null default 'draft',
  created_by uuid not null references public.profiles(id),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejected_by uuid references public.profiles(id),
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_id, version_number)
);

alter table public.menus
  add constraint menus_current_approved_version_fk
  foreign key (current_approved_version_id) references public.menu_versions(id);

-- At most one active (draft/pending_approval) version per menu at a time.
create unique index menu_versions_one_active_per_menu
  on public.menu_versions (menu_id)
  where status in ('draft', 'pending_approval');

create index menu_versions_menu_id_status_idx on public.menu_versions(menu_id, status);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  menu_version_id uuid not null references public.menu_versions(id) on delete cascade,
  item_name text not null,
  category text not null check (category in
    ('gravy', 'dal', 'rice', 'roti', 'vegetable', 'salad', 'sweet', 'other')),
  description text,
  display_order int not null default 0
);

create index menu_items_menu_version_id_idx on public.menu_items(menu_version_id);

alter table public.menus enable row level security;
alter table public.menu_versions enable row level security;
alter table public.menu_items enable row level security;
