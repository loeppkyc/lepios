-- 0231_food_catalog_amazon_asin.sql
-- Add amazon_asin column to food_catalog.
-- Powers Keepa price-alert wiring: keepa_price_alerts.asin can be seeded
-- from this column for household staples Colin wants to track on Amazon.ca.

ALTER TABLE public.food_catalog
  ADD COLUMN amazon_asin text;

CREATE INDEX idx_food_catalog_amazon_asin
  ON public.food_catalog (amazon_asin)
  WHERE amazon_asin IS NOT NULL;
