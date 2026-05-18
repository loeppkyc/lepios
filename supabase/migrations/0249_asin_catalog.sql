-- 0249_asin_catalog.sql
--
-- Universal ASIN catalog table.
-- Harvested weekly from Keepa /bestsellers endpoint.
-- Feeds deal-alert cross-reference: if an incoming deal is in this table,
-- alerts can include category context (LEGO, Toys, Books, etc.)
--
-- Category slugs must match HARVEST_CATEGORIES in lib/keepa/bestsellers.ts:
--   books | toys | lego | video_games | board_games | home | sports

CREATE TABLE IF NOT EXISTS asin_catalog (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  asin           TEXT        NOT NULL,
  domain         INTEGER     NOT NULL DEFAULT 6,
  category       TEXT        NOT NULL,  -- slug matching HARVEST_CATEGORIES
  category_id    BIGINT,                -- Keepa numeric category ID
  rank_position  INTEGER,               -- position in bestsellers list (1 = #1)
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup: one row per ASIN + domain combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_asin_catalog_asin_domain
  ON asin_catalog(asin, domain);

-- Query by category for cross-reference
CREATE INDEX IF NOT EXISTS idx_asin_catalog_category
  ON asin_catalog(category, domain);

-- Prune stale entries (not seen in last N weeks)
CREATE INDEX IF NOT EXISTS idx_asin_catalog_last_seen
  ON asin_catalog(last_seen_at DESC);

-- F24: service_role write grants required
GRANT INSERT, UPDATE, DELETE ON asin_catalog TO service_role;
