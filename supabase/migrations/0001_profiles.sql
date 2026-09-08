create type public.role as enum ('user', 'admin', 'super_admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_code text unique not null,
  full_name text not null,
  mobile text,
  email text,
  role public.role not null default 'user',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);

alter table public.profiles enable row level security;

-- Auto-create a profile row whenever a new auth user is created.
-- No client-side insert path into profiles exists, so a user can never
-- self-assign a role by inserting their own row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, user_code, full_name, email, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'user_code', substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    'user',
    true
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Only an active super_admin may change role or active status,
-- even though a user may update their own other profile fields.
create or replace function public.profiles_prevent_role_active_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active) then
    if not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin' and p.active = true
    ) then
      raise exception 'Only an active super_admin may change role or active status';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_before_update_lock_role_active
before update on public.profiles
for each row execute function public.profiles_prevent_role_active_change();
