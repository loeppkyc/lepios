-- Migration 0269: fix keepa_lightning_deals dedup index
--
-- Problem: the unique index was on (asin, domain, starts_at).
-- Because starts_at is NULL for nearly all deals (Keepa lightningStart=0 means
-- "no start time", not Unix epoch), Postgres treated every NULL as distinct and
-- inserted ~150 new rows per 4h scan for the exact same deals.
-- Result: table grew 150 rows/scan indefinitely.
--
-- Fix: replace with (asin, domain) unique index so each ASIN is stored once.
-- Stale rows with NULL discount_pct (all from the pre-fix buggy era) are
-- deleted first so the new index can be built on a clean, deduplicated table.

-- 1. Remove stale rows from the buggy era (all have discount_pct IS NULL)
DELETE FROM keepa_lightning_deals WHERE discount_pct IS NULL;

-- 2. Drop the old index that allowed NULL-duplicate rows
DROP INDEX IF EXISTS idx_kld_asin_starts;

-- 3. New unique index — one active deal record per ASIN per domain
CREATE UNIQUE INDEX idx_kld_asin_domain
  ON keepa_lightning_deals(asin, domain);

-- AD7-exempt (no new table, no INSERT/UPDATE grant needed)
