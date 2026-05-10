-- Retail cluster: watchlist with flip-profit fields.
-- Replaces Streamlit Google Sheets "Retail Scout" pipeline + watchlist tabs.
-- 20% better: Supabase-backed (queryable), status workflow, price history implicit in updated_at.

CREATE TABLE IF NOT EXISTS public.retail_watchlist (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  product          text           NOT NULL,
  brand            text,
  category         text,
  upc              text,
  asin             text,
  store            text           NOT NULL DEFAULT 'Unknown',
  buy_price        numeric(10,2),
  regular_price    numeric(10,2),
  pct_off          numeric(5,2),
  amazon_price     numeric(10,2),
  est_fba_fees     numeric(10,2),
  est_profit       numeric(10,2),
  roi_pct          numeric(5,2),
  target_buy_price numeric(10,2),
  current_price    numeric(10,2),
  url              text,
  status           text           NOT NULL DEFAULT 'watching'
                                  CHECK (status IN ('watching', 'active', 'passed', 'sold')),
  notes            text,
  alert_sent_at    timestamptz,
  is_active        boolean        NOT NULL DEFAULT true,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retail_watchlist_active_status_idx
  ON public.retail_watchlist(status) WHERE is_active;
CREATE INDEX IF NOT EXISTS retail_watchlist_created_idx
  ON public.retail_watchlist(created_at DESC);

ALTER TABLE public.retail_watchlist ENABLE ROW LEVEL SECURITY;

-- Personal OS — Colin only. service_role writes via API routes.
CREATE POLICY retail_watchlist_service_rw
  ON public.retail_watchlist FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT INSERT, UPDATE, DELETE ON public.retail_watchlist TO service_role;
