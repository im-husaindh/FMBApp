-- Replace per-category portion fields with a flexible per-item quantity map.
-- item_quantities stores {itemName: 0|1|2} for every menu item on that day.
-- Old columns are kept nullable for backward compatibility with existing rows.

ALTER TABLE thali_requests
  ADD COLUMN IF NOT EXISTS item_quantities jsonb;
