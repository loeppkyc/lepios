-- 0210_widen_cost_usd.sql
-- cost_usd was NUMERIC(8,6) — max $99.99, overflows on Claude Code session scans ($200-$300/day).
-- Widen to NUMERIC(12,4): supports up to $99,999,999 with 4 decimal places.
ALTER TABLE agent_events ALTER COLUMN cost_usd TYPE NUMERIC(12, 4);

GRANT INSERT, UPDATE, DELETE ON agent_events TO service_role;
