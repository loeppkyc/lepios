-- Migration 0038: Streamlit module scanner harness component
-- Registers the scanner tooling in harness_components.
-- Bump to 100% fires on PR merge via BUMP directive.

INSERT INTO harness_components (id, display_name, weight_pct, completion_pct, notes, updated_at)
VALUES (
  'harness:streamlit_module_scanner',
  'Streamlit module scanner',
  1.0,
  0.0,
  'Scanner + categorizer + spec generator for Streamlit rebuild queue. Outputs docs/streamlit-rebuild-queue.json. F18: count by category, complexity distribution. Benchmark: ~84 modules across 8 categories.',
  NOW()
)
ON CONFLICT (id) DO NOTHING;
