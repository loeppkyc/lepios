-- Keepa price alerts watchlist
-- Replaces Streamlit utils/product_intel.py Google Sheets tab
-- Supabase-backed: queryable, cron-checkable, no Sheets latency

CREATE TABLE keepa_price_alerts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asin            TEXT        NOT NULL,
  title           TEXT,
  alert_type      TEXT        NOT NULL
                    CHECK (alert_type IN ('price_below','price_above','rank_below','rank_above')),
  threshold       NUMERIC(10,2) NOT NULL,
  current_value   NUMERIC(10,2),
  last_checked_at TIMESTAMPTZ,
  triggered       BOOLEAN     NOT NULL DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_keepa_price_alerts_asin      ON keepa_price_alerts (asin);
CREATE INDEX idx_keepa_price_alerts_triggered ON keepa_price_alerts (triggered) WHERE triggered = TRUE;

ALTER TABLE keepa_price_alerts ENABLE ROW LEVEL SECURITY;

GRANT INSERT, UPDATE, DELETE ON keepa_price_alerts TO service_role;
