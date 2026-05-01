-- Migration 0057: amazon_financial_events — per-group SP-API event parsing
--
-- Backfills gross/fees_total/refunds_total on amazon_settlements by parsing
-- per-group /financialEventGroups/{id}/financialEvents SP-API responses.
--
-- New table: amazon_financial_events — one row per parsed event (ShipmentEvent,
--   RefundEvent, ServiceFeeEvent). Idempotency via delete-then-insert per group.
--
-- New columns on amazon_settlements:
--   reimbursements_total_cad — stub for v2 (AdjustmentEventList not parsed in v1)
--   skipped_event_types      — array of unrecognized event type names seen in group
--
-- Access model (matches 0052/0053 pattern — service_role only):
--   service_role  → full access (BYPASSRLS)
--   authenticated → DENY (no policy)
--   anon          → DENY (no policy)
--
-- Rollback:
--   DROP TABLE IF EXISTS public.amazon_financial_events;
--   ALTER TABLE public.amazon_settlements
--     DROP COLUMN IF EXISTS reimbursements_total_cad,
--     DROP COLUMN IF EXISTS skipped_event_types;

-- ── 1. New columns on amazon_settlements ──────────────────────────────────────

ALTER TABLE public.amazon_settlements
  ADD COLUMN IF NOT EXISTS reimbursements_total_cad NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS skipped_event_types      TEXT[];

COMMENT ON COLUMN public.amazon_settlements.reimbursements_total_cad IS
  'Reserved for v2 — currently always NULL. '
  'Reimbursements live in AdjustmentEventList which v1 does not parse.';

COMMENT ON COLUMN public.amazon_settlements.skipped_event_types IS
  'Non-empty event type names seen in this group that v1 did not parse '
  '(e.g. AdjustmentEvent, ChargebackEvent). NULL when none observed. '
  'Used to prioritise v2 event type coverage.';

-- ── 2. amazon_financial_events table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.amazon_financial_events (
  id                   TEXT         PRIMARY KEY,
  -- Deterministic sha256 hash: group_id:eventType:orderId:index
  -- Stable within a group's event set; safe to regenerate on delete-then-insert.

  group_id             TEXT         NOT NULL
    REFERENCES public.amazon_settlements(id) ON DELETE CASCADE,

  amazon_order_id      TEXT,
  -- AmazonOrderId from ShipmentEvent/RefundEvent. NULL for ServiceFeeEvent.
  -- Not a FK to orders (orders.id is composite "{AmazonOrderId}-{ASIN}").
  -- Index below enables fast future joins.

  event_type           TEXT         NOT NULL
    CHECK (event_type IN ('ShipmentEvent', 'RefundEvent', 'ServiceFeeEvent')),

  posted_date          DATE,
  -- Posted date in America/Edmonton timezone. Informational — aggregation
  -- does not depend on date (all events in a group are summed regardless).

  gross_contribution   NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Principal + ShippingCharge + GiftwrapCharge from ShipmentEvent.ItemChargeList.
  -- 0 for RefundEvent and ServiceFeeEvent.

  fees_contribution    NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- abs(ItemFeeList amounts) for ShipmentEvent;
  -- abs(FeeList amounts) for ServiceFeeEvent. 0 for RefundEvent.

  refunds_contribution NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- abs(negative ItemChargeList amounts) from RefundEvent. 0 for all others.

  raw_json             JSONB        NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.amazon_financial_events IS
  'One row per parsed SP-API financial event within a settlement group. '
  'Idempotency: delete-then-insert per group_id on each sync run. '
  'gross/fees/refunds on amazon_settlements are SUM of contributions here. '
  'Populated by lib/amazon/financial-events.ts:upsertFinancialEventsForGroup.';

-- Indexes
CREATE INDEX IF NOT EXISTS amazon_financial_events_group_id_idx
  ON public.amazon_financial_events (group_id);

CREATE INDEX IF NOT EXISTS amazon_financial_events_amazon_order_id_idx
  ON public.amazon_financial_events (amazon_order_id)
  WHERE amazon_order_id IS NOT NULL;
-- Future joins to orders table will use this index.

CREATE INDEX IF NOT EXISTS amazon_financial_events_event_type_idx
  ON public.amazon_financial_events (event_type);

-- ── 3. RLS — service_role only, no policy ────────────────────────────────────

ALTER TABLE public.amazon_financial_events ENABLE ROW LEVEL SECURITY;
-- No CREATE POLICY: service_role bypasses RLS automatically (BYPASSRLS).
-- authenticated and anon get empty result sets (no matching policy → deny).

