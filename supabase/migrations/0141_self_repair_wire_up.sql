-- 0141_self_repair_wire_up.sql
-- Self-repair v2 wire-up — seed harness_config keys for Sentry / Vercel /
-- Telegram-Vault pointer with empty-string placeholders. Re-runnable via
-- ON CONFLICT DO NOTHING — existing populated values are NEVER clobbered.
--
-- harness_config.value is NOT NULL (per Phase 1 audit), so we use empty
-- string '' as the "unset" marker. Night-watchman check modules treat empty
-- string as missing (`if (!token)` is truthy for ''), so the checks return
-- `skipped` until Colin populates the values.
--
-- TELEGRAM_BOT_TOKEN_VAULT_REF is the only key with a real value — it points
-- the daily-bot client at the Vault secret name. The actual token lands in
-- vault.secrets via Phase 4 manual setup.
--
-- RLS posture (verified in Phase 1): harness_config has RLS enabled with
-- 0 policies. service_role bypasses RLS, so this migration applies cleanly
-- and the night-watchman cron handlers (which use service_role) keep working.
-- No policy additions in this migration.

INSERT INTO public.harness_config (key, value, is_secret, description) VALUES
  ('SENTRY_API_TOKEN',
   '',
   true,
   'Sentry REST API token for night_watchman.errors.sentry_new_issues. Empty = check returns status=skipped.'),
  ('SENTRY_ORG_SLUG',
   '',
   false,
   'Sentry org slug (e.g. "loeppky"). Required alongside SENTRY_API_TOKEN for the Sentry issues check.'),
  ('SENTRY_PROJECT_SLUG',
   '',
   false,
   'Sentry project slug (e.g. "lepios"). Required alongside SENTRY_API_TOKEN.'),
  ('VERCEL_TOKEN',
   '',
   true,
   'Vercel REST API token for night_watchman.errors.deploy_state and cron-retry repair playbook. Empty = check skipped.'),
  ('VERCEL_PROJECT_ID',
   '',
   false,
   'Vercel project ID. Required alongside VERCEL_TOKEN. For lepios this is prj_dby74sE6ORPzWApBYh6ZkldZFXhH.'),
  ('TELEGRAM_BOT_TOKEN_VAULT_REF',
   'vault:telegram_bot_token_daily',
   false,
   'Pointer to the Vault secret name where the daily-bot token lives. v2 daily-bot client (lib/telegram/daily-bot.ts) reads vault.decrypted_secrets where name=telegram_bot_token_daily. Falls back to env TELEGRAM_BOT_TOKEN if Vault read fails.')
ON CONFLICT (key) DO NOTHING;
