-- Migration 0037: Amazon reports view harness component
-- Registers the /amazon reports page in harness_components for rollup tracking.
-- Auto-bump to 100% fires via BUMP directive on PR merge (PR description must contain:
--   BUMP: harness:amazon_reports_view=100

INSERT INTO harness_components (id, display_name, weight_pct, completion_pct, notes, updated_at)
VALUES (
  'harness:amazon_reports_view',
  'Amazon reports view (/amazon page)',
  1.0,
  0.0,
  'UI scaffold for orders + settlements at /amazon. KPI row, daily chart, top 10 sellers, settlements panel, status breakdown.',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Rollback:
--   DELETE FROM harness_components WHERE id = 'harness:amazon_reports_view';
