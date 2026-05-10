-- MID batch 3: Polymarket prediction log — replaces Google Sheets "Polymarket Predictions" tab

CREATE TABLE IF NOT EXISTS public.polymarket_predictions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_date       date        NOT NULL DEFAULT CURRENT_DATE,
  market           text        NOT NULL,
  pick             text        NOT NULL,
  buy_price        numeric(5,4),
  confidence       text        CHECK (confidence IN ('high', 'medium', 'low')),
  potential_return numeric(5,4),
  resolved         boolean     NOT NULL DEFAULT false,
  outcome          text,
  pnl              numeric(10,2),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS polymarket_predictions_user_idx  ON public.polymarket_predictions(user_id, trade_date DESC);
CREATE INDEX IF NOT EXISTS polymarket_predictions_open_idx  ON public.polymarket_predictions(user_id) WHERE resolved = false;

ALTER TABLE public.polymarket_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY polymarket_predictions_self
  ON public.polymarket_predictions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT INSERT, UPDATE, DELETE ON public.polymarket_predictions TO service_role;
