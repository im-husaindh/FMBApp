create or replace function public.is_before_request_cutoff(p_service_date date)
returns boolean
language sql
stable
as $$
  select now() < (
    ((p_service_date - interval '2 days')::date::text || ' ' ||
     (select value #>> '{}' from public.app_settings where key = 'cutoff_time'))::timestamp
    at time zone (select value #>> '{}' from public.app_settings where key = 'timezone')
  )
$$;
