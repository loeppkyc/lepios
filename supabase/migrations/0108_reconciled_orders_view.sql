-- One row per AmazonOrderId. Joins orders ↔ amazon_financial_events
-- ↔ amazon_settlements ↔ cogs_per_asin_view.
-- security_invoker = true: inherits RLS from base tables.
-- All /amazon routes must use createServiceClient() to read financial
-- event columns — authenticated role cannot see amazon_financial_events.

CREATE OR REPLACE VIEW public.reconciled_orders_view
WITH (security_invoker = true) AS
WITH order_events AS (
  -- Aggregate all financial event types per order so RefundEvent
  -- refunds_contribution is included alongside ShipmentEvent gross.
  SELECT
    amazon_order_id,
    SUM(gross_contribution)                AS event_gross_cad,
    SUM(fees_contribution)                 AS event_fees_cad,
    COALESCE(SUM(refunds_contribution), 0) AS event_refunds_cad,
    MIN(group_id)                          AS group_id
  FROM public.amazon_financial_events
  WHERE amazon_order_id IS NOT NULL
  GROUP BY amazon_order_id
),
order_cogs AS (
  -- Per-order COGS and pallet/missing signals.
  -- has_missing_cogs = true if any ASIN in the order has no cogs entry.
  SELECT
    o.amazon_order_id,
    SUM(cpav.weighted_avg_unit_cost * o.quantity) AS cogs_cad,
    BOOL_OR(cpav.has_pallet_entries IS TRUE)      AS has_pallet_cogs,
    BOOL_OR(cpav.asin IS NULL)                    AS has_missing_cogs
  FROM public.orders o
  LEFT JOIN public.cogs_per_asin_view cpav ON cpav.asin = o.asin
  WHERE o.amazon_order_id IS NOT NULL
  GROUP BY o.amazon_order_id
),
order_agg AS (
  -- Collapse order-item rows to order level.
  SELECT
    amazon_order_id,
    MIN(order_date)      AS first_order_date,
    MIN(fiscal_year)     AS fiscal_year,
    COUNT(DISTINCT asin) AS asin_count,
    SUM(quantity)        AS quantity_total,
    SUM(revenue_cad)     AS orders_revenue_cad
  FROM public.orders
  WHERE amazon_order_id IS NOT NULL
  GROUP BY amazon_order_id
)
SELECT
  oa.amazon_order_id,
  oa.first_order_date,
  oa.fiscal_year,
  oa.asin_count,
  oa.quantity_total,
  oa.orders_revenue_cad,
  oe.event_gross_cad,
  oe.event_fees_cad,
  oe.event_refunds_cad,
  s.id                                              AS settlement_id,
  s.period_start_at                                 AS settlement_period_start,
  s.period_end_at                                   AS settlement_period_end,
  oc.cogs_cad,
  oc.has_pallet_cogs,
  oa.orders_revenue_cad - oe.event_gross_cad        AS revenue_delta_cad,
  oe.event_gross_cad
    - oe.event_fees_cad
    - oe.event_refunds_cad
    - COALESCE(oc.cogs_cad, 0)                      AS net_profit_cad,
  CASE
    WHEN oe.amazon_order_id IS NULL THEN 'no_event'
    WHEN oc.has_missing_cogs         THEN 'no_cogs'
    WHEN oc.has_pallet_cogs          THEN 'no_cogs_pallet'
    ELSE 'reconciled'
  END                                               AS match_status
FROM order_agg oa
LEFT JOIN order_events oe ON oe.amazon_order_id = oa.amazon_order_id
LEFT JOIN public.amazon_settlements s ON s.id = oe.group_id
LEFT JOIN order_cogs oc ON oc.amazon_order_id = oa.amazon_order_id;
