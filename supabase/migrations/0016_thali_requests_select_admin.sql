-- Additive: ORs with the existing thali_requests_select_own policy (permissive,
-- the default) from supabase/migrations/0011_thali_requests_rls.sql. Without this,
-- admins/super_admins can only ever see their OWN thali_requests row under RLS,
-- making the /admin dashboard's food counts structurally always zero for every
-- other user. SELECT-only — does not touch the restrictive INSERT/UPDATE policies
-- from supabase/migrations/0015_thali_requests_leave_holiday_restriction.sql.
create policy thali_requests_select_admin on public.thali_requests
  for select
  using (public.is_admin());
