create policy menus_select on public.menus
  for select
  using (auth.uid() is not null);

create policy menus_insert_admin on public.menus
  for insert
  to authenticated
  with check (public.is_admin());

-- Deliberately no update/delete policy on menus for any client role: the only mutable
-- column (current_approved_version_id) is changed exclusively by the
-- approve_menu_version() SECURITY DEFINER RPC (migration 0009), which bypasses RLS
-- as the function owner.

create policy menu_versions_select on public.menu_versions
  for select
  using (status = 'approved' or public.is_admin());

create policy menu_versions_insert_admin on public.menu_versions
  for insert
  to authenticated
  with check (public.is_admin() and status = 'draft');

create policy menu_versions_update_admin on public.menu_versions
  for update
  using (public.is_admin() and status in ('draft', 'pending_approval', 'rejected'))
  with check (public.is_admin() and status in ('draft', 'pending_approval', 'rejected'));

-- Deliberately no client path to 'approved'/'superseded': those transitions happen
-- only inside approve_menu_version()/reject_menu_version() (migration 0009).

create policy menu_items_select on public.menu_items
  for select
  using (
    exists (
      select 1 from public.menu_versions v
      where v.id = menu_items.menu_version_id
        and (v.status = 'approved' or public.is_admin())
    )
  );

create policy menu_items_write_admin on public.menu_items
  for all
  using (
    exists (
      select 1 from public.menu_versions v
      where v.id = menu_items.menu_version_id
        and public.is_admin()
        and v.status in ('draft', 'rejected')
    )
  )
  with check (
    exists (
      select 1 from public.menu_versions v
      where v.id = menu_items.menu_version_id
        and public.is_admin()
        and v.status in ('draft', 'rejected')
    )
  );
