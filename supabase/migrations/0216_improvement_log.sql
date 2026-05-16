-- F19 continuous improvement loop — baseline metrics + delta per component build.
-- Every module ships with a baseline row; every subsequent build appends a delta row.
-- The improvement % is (current_value - baseline_value) / baseline_value * 100.

CREATE TABLE public.improvement_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  component       TEXT        NOT NULL,        -- e.g. 'arb-engine', 'twin', 'daily-scan'
  metric          TEXT        NOT NULL,        -- e.g. 'match_rate_pct', 'latency_ms', 'buy_rate_pct'
  unit            TEXT        NOT NULL,        -- e.g. 'pct', 'ms', 'count'
  value           NUMERIC     NOT NULL,
  is_baseline     BOOLEAN     NOT NULL DEFAULT false,
  build_ref       TEXT,                        -- git commit SHA or PR number
  notes           TEXT,
  meta            JSONB
);

CREATE INDEX ON public.improvement_log (component, metric, recorded_at);
CREATE INDEX ON public.improvement_log (recorded_at);

ALTER TABLE public.improvement_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "improvement_log_authenticated" ON public.improvement_log
  FOR SELECT USING (auth.uid() IS NOT NULL);

GRANT INSERT, UPDATE, DELETE ON public.improvement_log TO service_role;

-- Seed baseline rows for components shipping in this PR
INSERT INTO public.improvement_log (component, metric, unit, value, is_baseline, build_ref, notes) VALUES
  ('arb-engine', 'match_rate_pct',  'pct', 0, true, 'task-3a13fc07', 'baseline before first real scan'),
  ('arb-engine', 'buy_rate_pct',    'pct', 0, true, 'task-3a13fc07', 'baseline before first real scan'),
  ('arb-engine', 'scan_latency_ms', 'ms',  0, true, 'task-3a13fc07', 'baseline before first real scan');
