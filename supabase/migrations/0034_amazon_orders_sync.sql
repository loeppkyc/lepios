-- Migration 0034: Amazon orders sync harness component
-- Adds amazon_orders_sync to harness_components for rollup tracking.
-- Auto-bump to 100% fires via BUMP directive on PR merge (PR description must contain:
--   BUMP: harness:amazon_orders_sync=100

-- Note on orders table uniqueness: orders.id is the PK (text).
-- The sync layer uses id = "{AmazonOrderId}-{ASIN}" as a stable composite key,
-- so the existing PK constraint on id is sufficient for upsert dedup.
-- No additional unique index on (id, asin) is required.

INSERT INTO harness_components (id, display_name, weight_pct, completion_pct, notes)
VALUES (
  'harness:amazon_orders_sync',
  'Amazon orders sync cron',
  4.00,
  0.00,
  'Daily SP-API → orders table sync. Backfill 90d on first run, incremental 2d thereafter. F18 metrics in agent_events.'
)
ON CONFLICT (id) DO NOTHING;
