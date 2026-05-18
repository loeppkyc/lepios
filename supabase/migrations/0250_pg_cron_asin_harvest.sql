-- 0250_pg_cron_asin_harvest.sql
--
-- pg_cron job: call /api/cron/asin-harvest once per week (Sundays 6am UTC).
-- CRON_SECRET read at call-time from harness_config (same pattern as 0248).
-- No extra cost — uses Supabase's built-in pg_cron + pg_net extensions.
--
-- Keepa /bestsellers cost: ~50 tokens per category call x 7 categories = ~350 tokens/week.
-- Weekly schedule avoids the token exhaustion risk (F7).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT USAGE ON SCHEMA net  TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- Function: trigger_asin_harvest()
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_asin_harvest()
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
    RAISE WARNING 'trigger_asin_harvest: CRON_SECRET missing from harness_config — skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := 'https://lepios-one.vercel.app/api/cron/asin-harvest',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Schedule: weekly on Sundays at 6am UTC (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'asin_harvest_weekly') THEN
    PERFORM cron.unschedule('asin_harvest_weekly');
  END IF;
END;
$$;

SELECT cron.schedule(
  'asin_harvest_weekly',
  '0 6 * * 0',
  'SELECT public.trigger_asin_harvest()'
);

-- Verify
DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM cron.job WHERE jobname = 'asin_harvest_weekly';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'asin_harvest_weekly cron job not found after schedule';
  END IF;
  RAISE NOTICE 'asin_harvest_weekly scheduled OK (Sundays 6am UTC)';
END;
$$;
