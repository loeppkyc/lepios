-- 0266_automations.sql
-- CRUD automation manager: each row is a named automation with a trigger type,
-- action type, cron schedule, and run history. Supports manual "run now".

CREATE TYPE automation_trigger_type AS ENUM (
  'manual',
  'scheduled',
  'webhook',
  'event'
);

CREATE TYPE automation_action_type AS ENUM (
  'http_post',
  'telegram_message',
  'supabase_function',
  'custom'
);

CREATE TABLE automations (
  id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT                    NOT NULL,
  description     TEXT,
  trigger_type    automation_trigger_type NOT NULL DEFAULT 'manual',
  action_type     automation_action_type  NOT NULL DEFAULT 'http_post',
  cron_schedule   TEXT,
  action_config   JSONB                   NOT NULL DEFAULT '{}',
  enabled         BOOLEAN                 NOT NULL DEFAULT true,
  run_count       INTEGER                 NOT NULL DEFAULT 0,
  last_run_at     TIMESTAMPTZ,
  last_run_status TEXT,
  created_at      TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  owner_id        UUID                    REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX automations_owner_id  ON automations(owner_id);
CREATE INDEX automations_enabled   ON automations(enabled);
CREATE INDEX automations_trigger   ON automations(trigger_type);

ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own automations" ON automations
  FOR ALL USING (owner_id = auth.uid());

GRANT INSERT, UPDATE, DELETE ON automations TO service_role;
