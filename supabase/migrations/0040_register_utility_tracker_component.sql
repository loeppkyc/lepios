-- 0040_register_utility_tracker_component.sql
-- Registers utility tracker harness component at 100% completion.

INSERT INTO harness_components (id, display_name, weight_pct, completion_pct, notes, updated_at)
VALUES (
  'harness:streamlit_rebuild_utility_tracker',
  'Streamlit rebuild — Utility Tracker',
  1.0,
  100.0,
  'Tier 3 port of pages/52_Utility_Tracker.py. Supabase-backed; no Sheets dependency.',
  now()
);
