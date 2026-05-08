-- 0163_coordinator_v1.sql
-- T-001 Coordinator v1 remote invocation schema changes.
--
-- 1. Add 'api' to task_queue.source (for /api/coordinator/fire endpoint)
-- 2. Add triggered_by to window_sessions (telegram / cron / api / colin-paste)
-- 3. Seed harness_config runtime flags for remote coordinator loop

-- 1. Extend task_queue.source to include 'api'
ALTER TABLE public.task_queue
  DROP CONSTRAINT IF EXISTS task_queue_source_check,
  ADD  CONSTRAINT task_queue_source_check
    CHECK (source IN (
      'manual',
      'handoff-file',
      'colin-telegram',
      'cron',
      'improvement_engine',
      'api'
    ));

-- 2. Add triggered_by column to window_sessions (optional — NULL for legacy rows)
ALTER TABLE public.window_sessions
  ADD COLUMN IF NOT EXISTS triggered_by TEXT
    CHECK (triggered_by IN ('telegram', 'cron', 'api', 'colin-paste'));

-- 3. Seed coordinator runtime flags (ON CONFLICT DO NOTHING — safe to re-run)
-- HARNESS_REMOTE_INVOCATION_ENABLED: 'true' enables automatic coordinator fire on pickup
-- HARNESS_HALTED: 'true' stops the pickup loop; Colin sets via /halt Telegram command
INSERT INTO public.harness_config (key, value, is_secret) VALUES
  ('HARNESS_REMOTE_INVOCATION_ENABLED', 'true',  false),
  ('HARNESS_HALTED',                    'false', false)
ON CONFLICT (key) DO NOTHING;
