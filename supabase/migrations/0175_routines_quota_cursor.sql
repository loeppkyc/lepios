-- 0175 — Routines API quota cursor
-- Seeds three harness_config keys that give the quota guard and proactive forecast
-- an O(1) read path (harness_config lookup) instead of a per-tick agent_events scan.
--
-- ROUTINES_BACKOFF_UNTIL       ISO timestamp; empty string = no active backoff.
--                              Written by invoke-coordinator on 429, cleared on success.
-- ROUTINES_INVOCATIONS_TODAY   Rolling 24h successful-invocation count.
--                              Incremented on success; reset when window rolls over.
-- ROUTINES_INVOCATIONS_WINDOW_START  ISO timestamp of current 24h window open.
--                              Reset alongside the count when > 24h old.
--
-- Safe to re-run: ON CONFLICT (key) DO NOTHING never clobbers live values.

INSERT INTO harness_config (key, value) VALUES
  ('ROUTINES_BACKOFF_UNTIL',          ''),
  ('ROUTINES_INVOCATIONS_TODAY',       '0'),
  ('ROUTINES_INVOCATIONS_WINDOW_START', '')
ON CONFLICT (key) DO NOTHING;
