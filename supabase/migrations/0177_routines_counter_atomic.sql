-- Migration 0177: atomic increment_routines_counter() function
--
-- Replaces the read-modify-write pattern in invoke-coordinator.ts with a
-- single Postgres function call. Uses FOR UPDATE row locking to prevent
-- concurrent invocations from racing on ROUTINES_INVOCATIONS_TODAY.

CREATE OR REPLACE FUNCTION increment_routines_counter()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_window_start text;
  v_is_new_window boolean;
BEGIN
  -- Lock the window-start row first to serialize concurrent callers.
  SELECT value INTO v_window_start
  FROM harness_config
  WHERE key = 'ROUTINES_INVOCATIONS_WINDOW_START'
  FOR UPDATE;

  IF v_window_start IS NULL OR v_window_start = '' THEN
    v_is_new_window := true;
  ELSE
    v_is_new_window :=
      EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM v_window_start::timestamptz) > 86400;
  END IF;

  IF v_is_new_window THEN
    UPDATE harness_config SET value = '1'          WHERE key = 'ROUTINES_INVOCATIONS_TODAY';
    UPDATE harness_config SET value = NOW()::text  WHERE key = 'ROUTINES_INVOCATIONS_WINDOW_START';
  ELSE
    UPDATE harness_config
    SET    value = (COALESCE(NULLIF(value, '')::int, 0) + 1)::text
    WHERE  key   = 'ROUTINES_INVOCATIONS_TODAY';
  END IF;

  -- Clear any active backoff cursor now that a fire succeeded.
  UPDATE harness_config SET value = '' WHERE key = 'ROUTINES_BACKOFF_UNTIL';
END;
$$;
