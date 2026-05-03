-- Migration 0066: amazon_order_items — persistent cache for SP-API /orderItems responses
--
-- Eliminates N concurrent SP-API calls on every cache miss in the Business Review
-- recent-days route. Cache-first fetch: batch SELECT → identify misses → fetch
-- uncached at concurrency=2 → upsert → combine.
--
-- Access model (matches 0057/0054 pattern — service_role only):
--   service_role  → full access (BYPASSRLS)
--   authenticated → DENY (no policy)
--   anon          → DENY (no policy)
--
-- fetched_at updated on every upsert — use it as the cache freshness signal.
-- No hard TTL enforced at DB level; cache lib decides whether to re-fetch.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.amazon_order_items;

CREATE TABLE public.amazon_order_items (
  order_id                   text        NOT NULL,
  order_item_id              text        NOT NULL,
  asin                       text,
  seller_sku                 text,
  title                      text,
  quantity_ordered           int,
  quantity_shipped           int,
  item_price_amount          numeric,
  item_price_currency        text,
  item_tax_amount            numeric,
  item_tax_currency          text,
  promotion_discount_amount  numeric,
  shipping_price_amount      numeric,
  shipping_tax_amount        numeric,
  raw_json                   jsonb       NOT NULL,
  fetched_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, order_item_id)
);

COMMENT ON TABLE public.amazon_order_items IS
  'Persistent cache for SP-API /orders/v0/orders/{id}/orderItems responses. '
  'One row per order-item. Upserted by the business-review route on cache miss. '
  'fetched_at updated on every write — use it as the freshness signal. '
  'RLS enabled 2026-05-03 (migration 0066). No policies — service_role only.';

COMMENT ON COLUMN public.amazon_order_items.shipping_tax_amount IS
  'ShippingTax.Amount from SP-API orderItem. Captured for LepiOS tax/GST module '
  '(used in buildFinanceMap tax calculation alongside ItemTax.Amount).';

COMMENT ON COLUMN public.amazon_order_items.seller_sku IS
  'SellerSKU from SP-API orderItem. Not yet in SpOrderItem TypeScript type — '
  'populated via raw_json extraction until type is extended.';

COMMENT ON COLUMN public.amazon_order_items.quantity_shipped IS
  'QuantityShipped from SP-API orderItem. Not yet in SpOrderItem TypeScript type — '
  'populated via raw_json extraction until type is extended.';

CREATE INDEX amazon_order_items_order_id_idx ON public.amazon_order_items (order_id);
CREATE INDEX amazon_order_items_fetched_at_idx ON public.amazon_order_items (fetched_at);

ALTER TABLE public.amazon_order_items ENABLE ROW LEVEL SECURITY;
-- No CREATE POLICY: service_role bypasses RLS automatically (BYPASSRLS).
-- authenticated and anon get empty result sets (no matching policy → deny).
