-- 0211_retail_monitor_stocktrack.sql
-- Canonical migration for StockTrack port (Chunk C, task 645af95d).
-- Re-numbered from 0204 due to collision with 0204_receipt_lines.sql.
-- Uses IF NOT EXISTS / IF EXISTS guards throughout — safe to apply on top of
-- the earlier 0204_retail_monitor_stocktrack.sql if that was already applied.

-- 1. Expand retail_watchlist status CHECK (4 → 8 statuses)
ALTER TABLE public.retail_watchlist
  DROP CONSTRAINT IF EXISTS retail_watchlist_status_check;
ALTER TABLE public.retail_watchlist
  ADD CONSTRAINT retail_watchlist_status_check
  CHECK (status IN (
    'watching','active','bought','shipped_to_fba',
    'live_on_amazon','sold','passed','returned'
  ));

-- 2. StockTrack results cache
CREATE TABLE IF NOT EXISTS public.stocktrack_results (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code    text         NOT NULL,
  query         text,
  product_name  text         NOT NULL,
  sku           text,
  current_price numeric(10,2),
  regular_price numeric(10,2),
  discount_pct  numeric(5,1),
  in_stock      boolean      NOT NULL DEFAULT false,
  product_url   text,
  scanned_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stocktrack_results_store_scanned
  ON public.stocktrack_results (store_code, scanned_at DESC);
CREATE INDEX IF NOT EXISTS stocktrack_results_sku
  ON public.stocktrack_results (sku);
ALTER TABLE public.stocktrack_results ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY stocktrack_results_service_rw ON public.stocktrack_results
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
GRANT INSERT, UPDATE, DELETE ON public.stocktrack_results TO service_role;

-- 3. Scanner configs (replaces Google Sheet "🔔 Scanner Settings")
CREATE TABLE IF NOT EXISTS public.scanner_configs (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code       text         NOT NULL,
  min_discount_pct numeric(5,1) NOT NULL DEFAULT 30.0,
  keywords         text,
  enabled          boolean      NOT NULL DEFAULT true,
  last_scanned_at  timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);
ALTER TABLE public.scanner_configs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY scanner_configs_service_rw ON public.scanner_configs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
GRANT INSERT, UPDATE, DELETE ON public.scanner_configs TO service_role;
