revoke insert, update on public.thali_requests from authenticated, anon;

grant insert (user_id, service_date, wants_thali, gravy_portion_id,
              rice_portion_id, roti_quantity, updated_at),
      update (user_id, service_date, wants_thali, gravy_portion_id,
              rice_portion_id, roti_quantity, updated_at)
  on public.thali_requests to authenticated;
