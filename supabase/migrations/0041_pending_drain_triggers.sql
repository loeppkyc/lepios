-- 0041_pending_drain_triggers.sql
-- H1-B Stage 2: Supabase-native drain signal table.
-- Coordinator inserts a row instead of curling the drain endpoint (which requires
-- CRON_SECRET that is unavailable in the cloud sandbox). The notifications-drain
-- cron marks rows processed on each run.

CREATE TABLE IF NOT EXISTS pending_drain_triggers (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now() NOT NULL,
  triggered_by text NOT NULL,
  task_id      text,
  status       text DEFAULT 'pending' NOT NULL
                 CHECK (status IN ('pending', 'processed')),
  processed_at timestamptz
);
