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

-- Deliberately no insert policy on notifications for any client role — rows
-- are written only by lib/notifications' notify() helper, which runs with
-- the server's privileged Supabase client, never reachable from the browser.
