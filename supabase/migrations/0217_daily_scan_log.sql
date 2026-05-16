-- Daily scan agent output — persistent store for the iterative full-pass algorithm.
-- Each scan run appends one row; the twin corpus is seeded from these rows.

CREATE TABLE public.daily_scan_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  health_scores   JSONB,      -- { component: score (0-100) } per module
  top_gaps        JSONB,      -- ranked list of { component, gap, priority, reason }
  tasks_queued    INT         NOT NULL DEFAULT 0,
  task_ids        JSONB,      -- array of task_queue IDs inserted this run
  summary         TEXT,       -- plain-English summary for twin ingestion
  model           TEXT,       -- which model ran the scan (e.g. 'claude-sonnet-4-6')
  duration_ms     INT,
  meta            JSONB
);

CREATE INDEX ON public.daily_scan_log (scanned_at);

ALTER TABLE public.daily_scan_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_scan_log_authenticated" ON public.daily_scan_log
  FOR SELECT USING (auth.uid() IS NOT NULL);

GRANT INSERT, UPDATE, DELETE ON public.daily_scan_log TO service_role;
