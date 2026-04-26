-- Migration 0036: Amazon settlements sync
-- Stores one row per SP-API FinancialEventGroup (settlement period).
-- Upserted daily by /api/cron/amazon-settlements-sync (06:00 UTC).
--
-- gross, fees_total, refunds_total are nullable — deferred until
-- per-group /financialEvents parsing is implemented.
-- net_payout comes from FinancialEventGroup.OriginalTotal (the actual payout amount).
--
-- To backfill: hit /api/cron/amazon-settlements-sync?backfill=90
-- To inspect: SELECT id, period_start_at, period_end_at, net_payout, fund_transfer_status FROM amazon_settlements ORDER BY period_end_at DESC;

CREATE TABLE public.amazon_settlements (
  id                   TEXT         PRIMARY KEY,
  period_start_at      TIMESTAMPTZ,
  period_end_at        TIMESTAMPTZ,
  currency             TEXT         NOT NULL DEFAULT 'CAD',
  net_payout           NUMERIC(12,2),
  gross                NUMERIC(12,2),
  fees_total           NUMERIC(12,2),
  refunds_total        NUMERIC(12,2),
  fund_transfer_status TEXT,
  raw_json             JSONB        NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.amazon_settlements IS
  'One row per Amazon FinancialEventGroup (settlement period). '
  'net_payout = OriginalTotal (actual payout). gross/fees/refunds deferred. '
  'Upserted daily at 06:00 UTC by amazon-settlements-sync cron. CAD only.';

COMMENT ON COLUMN public.amazon_settlements.gross IS
  'Deferred: requires parsing per-group /financialEvents (ShipmentEvents). NULL until implemented.';

COMMENT ON COLUMN public.amazon_settlements.fees_total IS
  'Deferred: requires parsing per-group /financialEvents (ServiceFeeEvents). NULL until implemented.';

COMMENT ON COLUMN public.amazon_settlements.refunds_total IS
  'Deferred: requires parsing per-group /financialEvents (RefundEvents). NULL until implemented.';

CREATE INDEX amazon_settlements_period_end_at_idx ON public.amazon_settlements (period_end_at);
CREATE INDEX amazon_settlements_fund_transfer_status_idx ON public.amazon_settlements (fund_transfer_status);
CREATE INDEX amazon_settlements_currency_idx ON public.amazon_settlements (currency);

ALTER TABLE public.amazon_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "amazon_settlements_authenticated" ON public.amazon_settlements
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Harness component: tracks sync build completion.
-- Note: weight_pct invariant (SUM=100) should be re-normalised when component
-- list is stable. Following existing pattern from 0034.
INSERT INTO harness_components (id, display_name, weight_pct, completion_pct, notes)
VALUES (
  'harness:amazon_settlements_sync',
  'Amazon settlements sync cron',
  4.00,
  0.00,
  'Daily SP-API → amazon_settlements table sync. CAD only, 35d window, idempotent upserts. F18 metrics in agent_events.'
)
ON CONFLICT (id) DO NOTHING;

-- Rollback:
--   DROP TABLE IF EXISTS public.amazon_settlements;
--   DELETE FROM harness_components WHERE id = 'harness:amazon_settlements_sync';
