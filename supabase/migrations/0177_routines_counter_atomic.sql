-- Migration 0177: atomic ROUTINES_INVOCATIONS_TODAY increment
--
-- Gap: invoke-coordinator.ts used a read-modify-write sequence to bump
-- ROUTINES_INVOCATIONS_TODAY. Under concurrent 5-min pg_cron fires both
-- sessions read the same value, both write value+1 → net undercount of 1.
-- The 3-invoke safety buffer absorbs it, but it's a latent cliff risk as
-- the buffer shrinks.
--
-- Fix: replace read-modify-write with a single Postgres function that takes
-- a FOR UPDATE row lock before reading, then writes back atomically.
-- Concurrent callers queue behind the lock — no undercount possible.
--
-- Window reset: if ROUTINES_INVOCATIONS_WINDOW_START is absent or older than
-- 24h, the function resets both keys instead of incrementing. Mirrors the
-- quota-forecast fallback logic and prevents unbounded accumulation.

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
END;
$$;
