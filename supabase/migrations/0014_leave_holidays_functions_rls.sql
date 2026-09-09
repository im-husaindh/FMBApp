create or replace function public.is_on_leave(p_user_id uuid, p_service_date date)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.user_leaves
    where user_id = p_user_id and p_service_date between from_date and to_date
  )
$$;

create or replace function public.is_service_holiday(p_service_date date)
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.service_holidays where service_date = p_service_date)
$$;

-- A user must be able to see their own leave rows (needed so their own dashboard
-- can detect "you're on leave tomorrow"), and admins see everyone's.
create policy user_leaves_select on public.user_leaves
  for select
  using (user_id = auth.uid() or public.is_admin());

create policy user_leaves_write_admin on public.user_leaves
  for all
  using (public.is_admin())
  with check (public.is_admin());

create policy service_holidays_select on public.service_holidays
  for select
  using (auth.uid() is not null);

create policy service_holidays_write_super_admin on public.service_holidays
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());
