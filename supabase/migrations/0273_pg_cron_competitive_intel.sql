-- 0273_pg_cron_competitive_intel.sql
--
-- pg_cron job: call /api/cron/competitive-intel once per day at 9 AM UTC.
-- CRON_SECRET read at call-time from harness_config (same pattern as 0248 and 0250).
-- No extra cost — uses Supabase's built-in pg_cron + pg_net extensions.
-- NOTE: Do NOT add a Vercel cron entry — Vercel cron limit is already at capacity.
--
-- AD7-exempt (no CREATE TABLE)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT USAGE ON SCHEMA net  TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- Function: trigger_competitive_intel_scan()
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_competitive_intel_scan()
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
    RAISE WARNING 'trigger_competitive_intel_scan: CRON_SECRET missing from harness_config — skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := 'https://lepios-one.vercel.app/api/cron/competitive-intel',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Schedule: daily at 9 AM UTC (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'competitive_intel_daily') THEN
    PERFORM cron.unschedule('competitive_intel_daily');
  END IF;
END;
$$;

SELECT cron.schedule(
  'competitive_intel_daily',
  '0 9 * * *',
  'SELECT public.trigger_competitive_intel_scan()'
);

-- Verify
DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM cron.job WHERE jobname = 'competitive_intel_daily';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'competitive_intel_daily cron job not found after schedule';
  END IF;
  RAISE NOTICE 'competitive_intel_daily scheduled OK (daily 9 AM UTC)';
END;
$$;
