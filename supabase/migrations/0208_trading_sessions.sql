-- Trading Sessions — daily session journal with image storage
-- Migration: 0208
-- Branch: harness/coordinator-trading-sprint7
-- Claimed: 2026-05-15

CREATE TABLE IF NOT EXISTS public.trading_sessions (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date        date          NOT NULL,
  ticker              text          NOT NULL,
  strategy_name       text          NOT NULL,
  outcome             text          NOT NULL CHECK (outcome IN ('green', 'red', 'scratch')),
  net_pnl             numeric(10,2) NOT NULL,
  total_commissions   numeric(10,2),
  account_value_end   numeric(12,2),
  summary             text,
  key_lesson          text,
  chart_image_path    text,
  broker_image_path   text,
  trades_json         jsonb         NOT NULL DEFAULT '[]',
  tags                text[]        NOT NULL DEFAULT '{}',
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trading_sessions_date_ticker
  ON public.trading_sessions (session_date, ticker);

CREATE INDEX IF NOT EXISTS trading_sessions_date_idx
  ON public.trading_sessions (session_date DESC);

CREATE INDEX IF NOT EXISTS trading_sessions_ticker_idx
  ON public.trading_sessions (ticker, session_date DESC);

ALTER TABLE public.trading_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY trading_sessions_service_rw ON public.trading_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- F24: required write grants for service_role
GRANT INSERT, UPDATE, DELETE ON public.trading_sessions TO service_role;

-- Storage policy: service_role can read/write trading-charts bucket
INSERT INTO storage.policies (name, bucket_id, operation, definition)
VALUES
  ('trading_charts_service_read',  'trading-charts', 'SELECT', 'role() = ''service_role'''),
  ('trading_charts_service_insert','trading-charts', 'INSERT', 'role() = ''service_role'''),
  ('trading_charts_service_update','trading-charts', 'UPDATE', 'role() = ''service_role'''),
  ('trading_charts_service_delete','trading-charts', 'DELETE', 'role() = ''service_role''')
ON CONFLICT DO NOTHING;
