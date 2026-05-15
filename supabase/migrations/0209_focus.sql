-- Focus system: Pomodoro timer sessions, brain-dump open loops, daily time blocks
-- F24: GRANT statements required for all tables

-- ── open_loops ────────────────────────────────────────────────────────────────
CREATE TABLE public.open_loops (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text         TEXT        NOT NULL CHECK (char_length(text) > 0),
  status       TEXT        NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX open_loops_user_status_idx ON public.open_loops (user_id, status, created_at DESC);
ALTER TABLE public.open_loops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_loops_own" ON public.open_loops
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON public.open_loops TO service_role;

-- ── time_blocks ───────────────────────────────────────────────────────────────
CREATE TABLE public.time_blocks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  block_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
  start_hour        SMALLINT    NOT NULL CHECK (start_hour >= 0 AND start_hour <= 23),
  end_hour          SMALLINT    NOT NULL CHECK (end_hour >= 1 AND end_hour <= 24),
  label             TEXT        NOT NULL CHECK (char_length(label) > 0),
  color             TEXT        NOT NULL DEFAULT '#4a9eff',
  pomodoros_planned SMALLINT    NOT NULL DEFAULT 0 CHECK (pomodoros_planned >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT time_blocks_hours_order CHECK (end_hour > start_hour)
);
CREATE INDEX time_blocks_user_date_idx ON public.time_blocks (user_id, block_date DESC);
ALTER TABLE public.time_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "time_blocks_own" ON public.time_blocks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON public.time_blocks TO service_role;

-- ── focus_sessions ────────────────────────────────────────────────────────────
CREATE TABLE public.focus_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label            TEXT        NOT NULL DEFAULT 'Focus Session',
  duration_minutes SMALLINT    NOT NULL DEFAULT 25 CHECK (duration_minutes > 0),
  elapsed_seconds  INT         NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  status           TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
  pomodoro_type    TEXT        NOT NULL DEFAULT 'work'
                               CHECK (pomodoro_type IN ('work', 'short_break', 'long_break')),
  time_block_id    UUID        REFERENCES public.time_blocks(id) ON DELETE SET NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX focus_sessions_user_date_idx ON public.focus_sessions (user_id, created_at DESC);
CREATE INDEX focus_sessions_status_idx ON public.focus_sessions (status) WHERE status = 'active';
ALTER TABLE public.focus_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "focus_sessions_own" ON public.focus_sessions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON public.focus_sessions TO service_role;
