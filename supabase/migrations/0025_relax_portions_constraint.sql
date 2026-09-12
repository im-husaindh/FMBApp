-- The old CHECK constraint requires gravy/rice/roti columns to be set when
-- wants_thali=true.  The new item_quantities model stores per-item quantities
-- as jsonb instead, so those three columns are always NULL now.  Drop the
-- constraint so upserts with the new schema don't fail.
ALTER TABLE thali_requests DROP CONSTRAINT IF EXISTS thali_requests_portions_match_wants;
