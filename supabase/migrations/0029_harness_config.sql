-- harness_config: runtime config store for coordinator agent
-- Coordinator reads this at session start via mcp__Supabase__execute_sql.
-- Service role bypasses RLS; anon + authenticated have zero access.
CREATE TABLE public.harness_config (
  key        text        PRIMARY KEY,
  value      text        NOT NULL DEFAULT '',
  is_secret  boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.harness_config ENABLE ROW LEVEL SECURITY;
-- No permissive policies: anon + authenticated are locked out.
-- Service role bypasses RLS by default in Supabase -- no explicit policy needed.

-- Seed coordinator runtime config keys.
-- Colin MUST insert the real values after applying this migration:
--   UPDATE harness_config SET value = '<actual-value>' WHERE key = 'CRON_SECRET';
--   UPDATE harness_config SET value = '<actual-value>' WHERE key = 'TELEGRAM_CHAT_ID';
INSERT INTO public.harness_config (key, value, is_secret) VALUES
  ('CRON_SECRET',      '', true),
  ('TELEGRAM_CHAT_ID', '', false);
