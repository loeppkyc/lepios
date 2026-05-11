-- Keepa deal scan results — persisted so Data Explorer tab can browse history
-- Replaces Streamlit Google Sheets save_deals_batch()

CREATE TABLE keepa_deals (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asin                TEXT        NOT NULL,
  title               TEXT,
  category            TEXT,
  current_price_cad   NUMERIC(10,2),
  avg_90d_price_cad   NUMERIC(10,2),
  discount_pct        NUMERIC(5,1),
  bsr                 INT,
  domain              INT         NOT NULL DEFAULT 6,
  saved_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_keepa_deals_saved_at ON keepa_deals (saved_at DESC);
CREATE INDEX idx_keepa_deals_asin     ON keepa_deals (asin);
CREATE INDEX idx_keepa_deals_category ON keepa_deals (category);

ALTER TABLE keepa_deals ENABLE ROW LEVEL SECURITY;

GRANT INSERT, UPDATE, DELETE ON keepa_deals TO service_role;
