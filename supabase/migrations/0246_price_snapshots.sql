CREATE TABLE IF NOT EXISTS price_snapshots (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asin        TEXT NOT NULL,
  domain      INTEGER NOT NULL DEFAULT 6,  -- 6 = Amazon.ca
  price_type  TEXT NOT NULL,               -- 'amazon' | 'new' | 'used' | 'buybox' | 'bsr'
  value       NUMERIC(12,2),               -- price in CAD or BSR integer
  source      TEXT NOT NULL DEFAULT 'keepa',
  snapped_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One snapshot per ASIN per price_type per day (dedup)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ps_asin_type_day
  ON price_snapshots(asin, domain, price_type, (snapped_at::date));

CREATE INDEX IF NOT EXISTS idx_ps_asin_snapped
  ON price_snapshots(asin, domain, snapped_at DESC);

CREATE INDEX IF NOT EXISTS idx_ps_snapped
  ON price_snapshots(snapped_at);

GRANT INSERT, UPDATE, DELETE ON price_snapshots TO service_role;
