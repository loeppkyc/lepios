-- 0229_grocery_price_history.sql
-- Append-only price history per store product.
-- Written by the scraper on each run; never updated, only inserted.
-- Used for price trend analysis and deal detection.

CREATE TABLE public.grocery_price_history (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  grocery_product_id  uuid          NOT NULL REFERENCES public.grocery_products (id) ON DELETE CASCADE,
  price               numeric(10,2) NOT NULL,
  is_sale             boolean       NOT NULL DEFAULT false,
  scraped_at          timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.grocery_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grocery_price_history_authenticated"
  ON public.grocery_price_history FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX idx_grocery_price_history_product ON public.grocery_price_history (grocery_product_id);
CREATE INDEX idx_grocery_price_history_scraped ON public.grocery_price_history (scraped_at DESC);

-- AD7-exempt: append-only; no UPDATE or DELETE needed
GRANT INSERT ON public.grocery_price_history TO service_role;
