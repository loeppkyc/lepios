-- Register tax_sanity as a harness component.
-- Weight 1: single morning_digest signal, not a major subsystem.
-- Rollup formula normalises by SUM(weight_pct), so no rebalancing needed.

INSERT INTO public.harness_components
  (id, display_name, weight_pct, completion_pct, notes)
VALUES
  ('harness:tax_sanity', 'Tax sanity check', 1, 100,
   'morning_digest guard-rail: GST 2.5% + CPP+tax 0.26% baseline ratios, 25% drift threshold')
ON CONFLICT (id) DO NOTHING;
