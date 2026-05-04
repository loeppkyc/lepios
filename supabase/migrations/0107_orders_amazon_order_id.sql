-- Adds a stored generated column that derives the AmazonOrderId from
-- orders.id which is formatted as "{AmazonOrderId}-{ASIN}".
-- Backfills all existing rows at migration time; no manual UPDATE needed.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS amazon_order_id TEXT
    GENERATED ALWAYS AS (
      left(id, length(id) - length(asin) - 1)
    ) STORED;

CREATE INDEX IF NOT EXISTS orders_amazon_order_id_idx
  ON public.orders (amazon_order_id);
