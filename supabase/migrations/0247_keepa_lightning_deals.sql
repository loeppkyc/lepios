-- Migration 0247: keepa_lightning_deals
-- Persists lightning deal snapshots for dedup + history
-- Branch: feat/price-intel-lightning

CREATE TABLE IF NOT EXISTS keepa_lightning_deals (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asin         TEXT NOT NULL,
  domain       INTEGER NOT NULL DEFAULT 6,
  title        TEXT,
  deal_price   NUMERIC(10,2),
  orig_price   NUMERIC(10,2),
  discount_pct NUMERIC(5,2),
  deal_type    TEXT,          -- 'lightning' | 'best'
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  alerted      BOOLEAN NOT NULL DEFAULT false,
  found_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kld_asin_starts
  ON keepa_lightning_deals(asin, domain, starts_at);

CREATE INDEX IF NOT EXISTS idx_kld_found ON keepa_lightning_deals(found_at DESC);
CREATE INDEX IF NOT EXISTS idx_kld_ends  ON keepa_lightning_deals(ends_at);

-- F24: service_role write grants
GRANT INSERT, UPDATE, DELETE ON keepa_lightning_deals TO service_role;
