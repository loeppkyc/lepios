-- 0230_grocery_products_catalog_store_unique.sql
-- Add UNIQUE constraint on (food_catalog_id, store) so the Flipp sync can upsert:
-- same catalog item found at the same store → update price/flyer flag, not insert duplicate.
-- NULL food_catalog_id rows are exempt (PostgreSQL NULL != NULL uniqueness) — manually-added
-- products without a catalog link can coexist per store without triggering this constraint.

ALTER TABLE public.grocery_products
  ADD CONSTRAINT grocery_products_catalog_store_unique
  UNIQUE (food_catalog_id, store);
