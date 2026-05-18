-- 0275_pg_cron_synthesis.sql
--
-- pg_cron job: call /api/synthesis/run every 6 hours.
-- Vercel Hobby cron slots exhausted (33 entries — limit is 18).
-- CRON_SECRET read at call-time from harness_config (same pattern as 0248).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT USAGE ON SCHEMA net  TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- Function: trigger_synthesis_run()
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_synthesis_run()
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
    RAISE WARNING 'trigger_synthesis_run: CRON_SECRET missing from harness_config — skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := 'https://lepios-one.vercel.app/api/synthesis/run',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Schedule: every 6 hours (idempotent — unschedule first if exists)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'synthesis_run_6h') THEN
    PERFORM cron.unschedule('synthesis_run_6h');
  END IF;
END;
$$;

SELECT cron.schedule(
  'synthesis_run_6h',
  '0 */6 * * *',
  'SELECT public.trigger_synthesis_run()'
);

-- Verify
DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM cron.job WHERE jobname = 'synthesis_run_6h';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'synthesis_run_6h cron job not found after schedule';
  END IF;
  RAISE NOTICE 'synthesis_run_6h scheduled OK (every 6 hours)';
END;
$$;
