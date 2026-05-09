-- 0168_pg_cron_liveness_driver.sql
--
-- Supabase pg_cron + pg_net liveness driver.
-- Replaces Vercel Hobby daily-only cron limitation for three high-frequency paths:
--   1. LAST_HEARTBEAT_AT upsert         → every 1 minute
--   2. /api/cron/task-pickup            → every 5 minutes
--   3. /api/cron/notifications-drain-tick → every 5 minutes (offset 2m)
--
-- F-N29: Vercel Hobby = daily crons only. Heartbeat DMS + continuous loop both
-- broken without sub-15-min trigger. Mitigation: pg_cron + pg_net (free, DB-side).
--
-- SECURITY NOTE: CRON_SECRET is read at call-time from harness_config (not hardcoded).
-- Functions are SECURITY DEFINER so pg_cron's postgres role can read service-side rows.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enable extensions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Required grant for pg_cron on Supabase
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT USAGE ON SCHEMA net  TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. upsert_heartbeat_pg()
--    Mirrors lib/orchestrator/heartbeat.ts — UPSERTs LAST_HEARTBEAT_AT in
--    harness_config. Warns if the key is missing (F-N21 guard).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_heartbeat_pg()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  UPDATE harness_config
  SET value = NOW()::text
  WHERE key = 'LAST_HEARTBEAT_AT';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE WARNING 'upsert_heartbeat_pg: LAST_HEARTBEAT_AT missing from harness_config — 0 rows updated';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. trigger_task_pickup()
--    Calls /api/cron/task-pickup with CRON_SECRET read from harness_config.
--    Fire-and-forget (pg_net async). Returns immediately; Vercel handles the work.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_task_pickup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT value INTO v_secret FROM harness_config WHERE key = 'CRON_SECRET';
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING 'trigger_task_pickup: CRON_SECRET missing from harness_config — skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := 'https://lepios-one.vercel.app/api/cron/task-pickup',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. trigger_notifications_drain()
--    Calls /api/cron/notifications-drain-tick every 5 min (offset 2 min).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_notifications_drain()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT value INTO v_secret FROM harness_config WHERE key = 'CRON_SECRET';
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING 'trigger_notifications_drain: CRON_SECRET missing from harness_config — skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := 'https://lepios-one.vercel.app/api/cron/notifications-drain-tick',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Schedule via pg_cron (idempotent — unschedule-if-exists before re-adding)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Remove stale jobs if they exist from a prior apply
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'heartbeat_minute') THEN
    PERFORM cron.unschedule('heartbeat_minute');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'task_pickup_5min') THEN
    PERFORM cron.unschedule('task_pickup_5min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notifications_drain_5min') THEN
    PERFORM cron.unschedule('notifications_drain_5min');
  END IF;
END;
$$;

-- Heartbeat: every minute — keeps /api/health/lease alive between Vercel crons
SELECT cron.schedule(
  'heartbeat_minute',
  '* * * * *',
  'SELECT public.upsert_heartbeat_pg()'
);

-- Task pickup: every 5 minutes — drives the autonomous coordinator loop
SELECT cron.schedule(
  'task_pickup_5min',
  '*/5 * * * *',
  'SELECT public.trigger_task_pickup()'
);

-- Notifications drain: every 5 min, offset by 2 min to avoid collision with task pickup
SELECT cron.schedule(
  'notifications_drain_5min',
  '2-57/5 * * * *',
  'SELECT public.trigger_notifications_drain()'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Verify schedule was created
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM cron.job
  WHERE jobname IN ('heartbeat_minute', 'task_pickup_5min', 'notifications_drain_5min');

  IF v_count < 3 THEN
    RAISE EXCEPTION 'pg_cron schedule verification failed: expected 3 jobs, found %', v_count;
  END IF;

  RAISE NOTICE 'pg_cron liveness driver: % jobs scheduled OK', v_count;
END;
$$;
