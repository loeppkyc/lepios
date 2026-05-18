-- Migration 0276: Schedule lightning-deals Edge Function via pg_cron
-- Replaces Vercel cron — no build-rate-limit dependency.
-- Edge Function URL: https://xpanlbcjueimeofgsara.supabase.co/functions/v1/lightning-deals
-- Auth: Bearer CRON_SECRET read dynamically from harness_config at execution time.
-- Applied directly 2026-05-18 before this file was committed.

SELECT cron.schedule(
  'lightning-deals-edge',
  '0 */4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://xpanlbcjueimeofgsara.supabase.co/functions/v1/lightning-deals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM harness_config WHERE key = 'CRON_SECRET')
    ),
    body := '{}'::jsonb
  )
  $$
);

GRANT USAGE ON SCHEMA cron TO service_role; -- AD7-exempt: cron scheduling, not a table
