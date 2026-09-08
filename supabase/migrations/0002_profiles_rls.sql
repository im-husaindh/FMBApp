create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'super_admin') and active = true
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin' and active = true
  );
$$;

-- A user may read their own row; admins/super_admins may read every row.
create policy profiles_select on public.profiles
  for select
  using (id = auth.uid() or public.is_admin());

-- A user may update their own row (role/active changes are separately
-- blocked by the trigger from migration 0001 regardless of this policy).
create policy profiles_update_own on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- A super_admin may update any row (needed to change other users' role/active).
create policy profiles_update_super_admin on public.profiles
  for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- No insert/delete policy for any client role: profiles are only created
-- by the handle_new_user trigger and never deleted (deactivate instead).
