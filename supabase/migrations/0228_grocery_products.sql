-- 0228_grocery_products.sql
-- Store-specific product listings linked to food_catalog.
-- Scraper-ready: tracks SKU, URL, price, and last-scraped timestamp per store.
-- Supports multi-store price comparison for Edmonton grocery shopping.

CREATE TABLE public.grocery_products (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  food_catalog_id   uuid          REFERENCES public.food_catalog (id) ON DELETE SET NULL,
  name              text          NOT NULL,
  store             text          NOT NULL CHECK (store IN (
                      'superstore', 'save-on', 'walmart', 'costco',
                      'safeway', 'no-frills', 'sobeys', 'other'
                    )),
  store_sku         text,
  store_url         text,
  unit_size         text,
  regular_price     numeric(10,2),
  sale_price        numeric(10,2),
  price_per_100g    numeric(10,4),
  last_scraped_at   timestamptz,
  in_flyer          boolean       NOT NULL DEFAULT false,
  is_active         boolean       NOT NULL DEFAULT true,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.grocery_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grocery_products_authenticated"
  ON public.grocery_products FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX idx_grocery_products_catalog  ON public.grocery_products (food_catalog_id);
CREATE INDEX idx_grocery_products_store    ON public.grocery_products (store);
CREATE INDEX idx_grocery_products_flyer    ON public.grocery_products (in_flyer)
  WHERE in_flyer = true;
CREATE INDEX idx_grocery_products_active   ON public.grocery_products (is_active)
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION update_grocery_products_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER grocery_products_updated_at
  BEFORE UPDATE ON public.grocery_products
  FOR EACH ROW EXECUTE FUNCTION update_grocery_products_updated_at();

GRANT INSERT, UPDATE, DELETE ON public.grocery_products TO service_role;
