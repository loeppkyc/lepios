-- 0245_ra_scout_scans.sql
-- Log of RA Scout shelf scans (Meta Ray-Bans / phone camera → Claude vision → profitability).
-- results JSONB: array of { set_number, name, asin, amazon_price_cad, fba_fee_est_cad,
--   buy_price_cad, net_margin_pct, verdict: 'BUY'|'WATCH'|'SKIP' }

CREATE TABLE ra_scout_scans (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  location_note        TEXT,
  detected_set_numbers TEXT[]      NOT NULL DEFAULT '{}',
  results              JSONB       NOT NULL DEFAULT '[]',
  profitable_count     INTEGER     NOT NULL DEFAULT 0,
  scanned_by           UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX rss_scanned_at    ON ra_scout_scans(scanned_at DESC);
CREATE INDEX rss_scanned_by    ON ra_scout_scans(scanned_by);

GRANT INSERT, UPDATE, DELETE ON ra_scout_scans TO service_role;
