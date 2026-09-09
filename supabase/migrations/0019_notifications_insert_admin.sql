create policy notifications_insert_admin on public.notifications
  for insert with check (public.is_admin());
