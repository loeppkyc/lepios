-- Chunk C: eBay active listing comp fields
-- "listing" not "sold" — these are active asking prices via Browse API (Finding API sunset Jan 2025)
ALTER TABLE public.scan_results
  ADD COLUMN IF NOT EXISTS ebay_listing_median_cad  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ebay_listing_count       INT,
  ADD COLUMN IF NOT EXISTS ebay_profit_cad          NUMERIC(10,2);
