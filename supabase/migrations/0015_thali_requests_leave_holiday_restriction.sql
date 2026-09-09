-- Restrictive policies AND with the existing permissive insert/update policies from
-- Phase 3a (supabase/migrations/0011_thali_requests_rls.sql) rather than replacing
-- them — this migration never touches that file or its policies.
create policy thali_requests_insert_not_leave_or_holiday on public.thali_requests
  as restrictive
  for insert
  with check (
    not public.is_on_leave(user_id, service_date)
    and not public.is_service_holiday(service_date)
  );

create policy thali_requests_update_not_leave_or_holiday on public.thali_requests
  as restrictive
  for update
  with check (
    not public.is_on_leave(user_id, service_date)
    and not public.is_service_holiday(service_date)
  );
