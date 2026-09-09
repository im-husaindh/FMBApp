create or replace function public.is_before_request_cutoff(p_service_date date)
returns boolean
language sql
stable
as $$
  select now() < (
    ((p_service_date - interval '1 day')::date::text || ' ' ||
     (select value #>> '{}' from public.app_settings where key = 'cutoff_time'))::timestamp
    at time zone (select value #>> '{}' from public.app_settings where key = 'timezone')
  )
$$;

create policy thali_requests_select_own on public.thali_requests
  for select
  using (user_id = auth.uid());

create policy thali_requests_insert_own on public.thali_requests
  for insert
  with check (user_id = auth.uid() and public.is_before_request_cutoff(service_date));

create policy thali_requests_update_own on public.thali_requests
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_before_request_cutoff(service_date));
