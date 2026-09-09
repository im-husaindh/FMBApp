create policy concerns_select_own_or_admin on public.concerns
  for select using (user_id = auth.uid() or public.is_admin());

create policy concerns_insert_own on public.concerns
  for insert with check (user_id = auth.uid());

create policy concerns_update_admin on public.concerns
  for update using (public.is_admin()) with check (public.is_admin());

create policy concern_updates_select_own_or_admin on public.concern_updates
  for select using (
    public.is_admin()
    or exists (select 1 from public.concerns c where c.id = concern_id and c.user_id = auth.uid())
  );

create policy concern_updates_insert_admin on public.concern_updates
  for insert with check (public.is_admin());

create policy notifications_select_own on public.notifications
  for select using (recipient_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- Notifications are inserted only by admin actions calling notify() (see
-- migration 0019's notifications_insert_admin policy) — there is no
-- privileged service-role client anywhere in this app's runtime code,
-- only in offline scripts/tests, so the insert path must go through this
-- ordinary admin-scoped RLS policy instead.
