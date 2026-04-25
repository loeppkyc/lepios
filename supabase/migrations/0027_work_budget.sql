-- Migration 0027 — Work-Budget Mode
-- Adds: work_budget_sessions, work_budget_keyword_weights, task_queue estimation columns

-- work_budget_sessions table
CREATE TABLE public.work_budget_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'drained', 'stopped')),
  budget_minutes INTEGER NOT NULL CHECK (budget_minutes BETWEEN 10 AND 480),
  used_minutes INTEGER NOT NULL DEFAULT 0 CHECK (used_minutes >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'telegram',
  telegram_chat_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'
);

-- calibration weight table (seeded with initial heuristic values)
CREATE TABLE public.work_budget_keyword_weights (
  keyword TEXT PRIMARY KEY,
  weight_minutes INTEGER NOT NULL,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.work_budget_keyword_weights (keyword, weight_minutes) VALUES
  ('migration', 10),
  ('test', 15),
  ('tests', 15),
  ('study doc', 20),
  ('phase 1a', 20),
  ('acceptance doc', 25),
  ('phase 1d', 25),
  ('multi-file', 15),
  ('multiple files', 15),
  ('port', 30),
  ('streamlit port', 30),
  ('fix', -10),
  ('cleanup', -10),
  ('update', -10);

-- task_queue: estimation + calibration columns
ALTER TABLE public.task_queue
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS actual_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS estimation_error_pct INTEGER;
