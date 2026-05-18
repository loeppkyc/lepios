-- 0242_lego_asin_catalog.sql
-- Master ASIN catalog for all LEGO sets tracked on Amazon.ca.
-- Populated by the /api/admin/lego-catalog/harvest endpoint (Keepa lookup by set number).
-- Price alert rules live in 0243_price_alert_rules.sql.

CREATE TABLE lego_asin_catalog (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  set_number      TEXT        NOT NULL UNIQUE,
  asin            TEXT,
  name            TEXT        NOT NULL,
  msrp_cad        NUMERIC,
  retire_flag     BOOLEAN     NOT NULL DEFAULT false,
  last_price_cad  NUMERIC,
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX lac_asin ON lego_asin_catalog(asin) WHERE asin IS NOT NULL;

GRANT INSERT, UPDATE, DELETE ON lego_asin_catalog TO service_role;
