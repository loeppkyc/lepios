-- 0243_price_alert_rules.sql
-- User-defined price alert rules per LEGO set.
-- Cron job (keepa-price-scan) checks these daily and fires Telegram alerts.
-- drop_pct_threshold: alert when Amazon price is this % below msrp_cad (e.g. 20 = 20% off)
-- absolute_price_cap_cad: also alert when price falls below this value regardless of % (optional)

CREATE TABLE price_alert_rules (
  id                     UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  set_number             TEXT    NOT NULL REFERENCES lego_asin_catalog(set_number) ON DELETE CASCADE,
  drop_pct_threshold     NUMERIC NOT NULL DEFAULT 20,
  absolute_price_cap_cad NUMERIC,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  last_alerted_at        TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX par_set_number ON price_alert_rules(set_number) WHERE is_active = true;

GRANT INSERT, UPDATE, DELETE ON price_alert_rules TO service_role;
