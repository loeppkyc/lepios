-- Migration 0279: personal_tasks — Colin's personal task list (distinct from harness task_queue)
CREATE TABLE IF NOT EXISTS personal_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date_added   DATE NOT NULL DEFAULT CURRENT_DATE,
  priority     INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),
  task         TEXT NOT NULL,
  assigned_to  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
  date_done    DATE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT INSERT, UPDATE, DELETE ON personal_tasks TO service_role;
