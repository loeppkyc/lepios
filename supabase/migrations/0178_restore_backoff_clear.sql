-- Migration 0178: restore ROUTINES_BACKOFF_UNTIL clear in increment_routines_counter()
--
-- PR #201 cleared the backoff cursor on every successful coordinator fire.
-- The #202 sync dropped that line. Without it, a stale ROUTINES_BACKOFF_UNTIL
-- (written on 429) can block pickup even after a manual /resume succeeds,
-- because quota-guard reads the cursor before checking agent_events.
--
-- Fix: add one UPDATE at the end of increment_routines_counter() so every
-- successful invocation self-heals the backoff cursor.

CREATE OR REPLACE FUNCTION public.increment_routines_counter()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  v_count  int;
  v_window timestamptz;
BEGIN
  -- Lock each row individually (FOR UPDATE incompatible with aggregate fns).
  SELECT value::int
  INTO v_count
  FROM public.harness_config
  WHERE key = 'ROUTINES_INVOCATIONS_TODAY'
  FOR UPDATE;

  SELECT value::timestamptz
  INTO v_window
  FROM public.harness_config
  WHERE key = 'ROUTINES_INVOCATIONS_WINDOW_START'
  FOR UPDATE;

  IF v_window IS NOT NULL AND (pg_catalog.now() - v_window) < INTERVAL '24 hours' THEN
    UPDATE public.harness_config
    SET value = ((COALESCE(v_count, 0) + 1)::text)
    WHERE key = 'ROUTINES_INVOCATIONS_TODAY';
  ELSE
    UPDATE public.harness_config
    SET value = '1'
    WHERE key = 'ROUTINES_INVOCATIONS_TODAY';

    UPDATE public.harness_config
    SET value = pg_catalog.now()::text
    WHERE key = 'ROUTINES_INVOCATIONS_WINDOW_START';
  END IF;

  -- Clear stale backoff cursor so a successful fire self-heals after /resume.
  UPDATE public.harness_config
  SET value = ''
  WHERE key = 'ROUTINES_BACKOFF_UNTIL';
END;
$$;
