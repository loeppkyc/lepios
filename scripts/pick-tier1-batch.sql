-- pick-tier1-batch.sql
-- Reference query for selecting the next batch of Tier 1 Streamlit port modules.
--
-- FILTER RULES (updated 2026-04-25 after first batch produced 4 empty __init__.py files):
--   1. suggested_tier = 1
--   2. classification NOT IN ('dead', 'test')
--   3. lines >= 20                          -- excludes empty namespace markers (1–2 line __init__.py)
--   4. NOT (f17_signal IS NULL AND classification = 'config')
--                                           -- config files with no behavioral signal are not worth porting
--   5. port_status IS NULL OR port_status NOT IN ('ported', 'in_progress')
--                                           -- skip already-handled modules
--
-- ORDER: deps_in (fewest dependents first = safest to break), then lines ASC (fastest to build)
-- LIMIT: 6 per batch (matches Telegram review capacity)
--
-- Why these filters:
--   - lines < 20 caught: tests/__init__.py (1 line), crawlers/__init__.py (1 line),
--     tools/__init__.py (1 line), pages/tax_centre/__init__.py (2 lines)
--   - All 4 were cancelled manually on 2026-04-25 (status='cancelled',
--     cancelled_reason='Empty namespace marker — no port needed')
--   - Config files with no f17_signal have no behavioral ingestion value per F17 rule

SELECT
  id,
  path,
  lines,
  classification,
  array_length(deps_in, 1)   AS deps_in_count,
  array_length(deps_out, 1)  AS deps_out_count,
  deps_out,
  suggested_chunks,
  f17_signal,
  f18_metric_candidate,
  external_deps
FROM streamlit_modules
WHERE suggested_tier = 1
  AND classification NOT IN ('dead', 'test')
  AND lines >= 20
  AND NOT (f17_signal IS NULL AND classification = 'config')
  AND (port_status IS NULL OR port_status NOT IN ('ported', 'in_progress'))
ORDER BY
  array_length(deps_in, 1) ASC NULLS FIRST,
  lines ASC
LIMIT 6;
