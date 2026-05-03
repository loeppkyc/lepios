-- 0101_lepios_base_url.sql
-- Add LEPIOS_BASE_URL to coordinator runtime config.
-- Colin must UPDATE this value after migration:
--   UPDATE harness_config SET value = 'https://lepios-one.vercel.app'
--   WHERE key = 'LEPIOS_BASE_URL';
INSERT INTO public.harness_config (key, value, is_secret)
VALUES ('LEPIOS_BASE_URL', '', false)
ON CONFLICT (key) DO NOTHING;
