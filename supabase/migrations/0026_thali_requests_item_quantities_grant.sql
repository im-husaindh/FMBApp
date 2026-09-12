-- Migration 0012 granted column-level INSERT/UPDATE on thali_requests but did
-- not include item_quantities (added later in 0024). Add it now so authenticated
-- users can write the new per-item quantity data.
grant insert (item_quantities), update (item_quantities)
  on public.thali_requests to authenticated;
