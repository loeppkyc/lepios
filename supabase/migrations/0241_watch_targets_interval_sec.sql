-- 0241_watch_targets_interval_sec.sql
-- Add check_interval_sec to watch_targets for sub-minute polling (hot-drop mode).
-- When set, takes precedence over check_interval_min.
-- Example: check_interval_sec = 30 → poll every 30 seconds.
-- check_interval_min is kept as the coarse default (minutes, integer).

ALTER TABLE public.watch_targets
  ADD COLUMN IF NOT EXISTS check_interval_sec integer;

-- Also expand the type enum to allow 'shopify' for future Shopify storefronts.
ALTER TABLE public.watch_targets
  DROP CONSTRAINT IF EXISTS watch_targets_type_check;

ALTER TABLE public.watch_targets
  ADD CONSTRAINT watch_targets_type_check
    CHECK (type IN ('amazon-asin', 'lego-ca', 'generic-url', 'shopify'));

-- AD7-exempt: additive columns only, no write grants needed beyond what 0238 set.
