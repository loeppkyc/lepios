-- 0212_bookkeeping_ingest_runs.sql
-- Adds ingest_runs table: one row per CLI bookkeeping ingest execution.
-- Enables the reconcile UI to surface "Last ingested: {date} — {N} rows loaded."
-- Written by the ingest CLI script (or manually) via service_role.

CREATE TABLE IF NOT EXISTS public.ingest_runs (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at          timestamptz  NOT NULL DEFAULT now(),
  source          text         NOT NULL,   -- 'td_pdf' | 'csv' | 'amazon_match' | 'manual'
  rows_added      integer      NOT NULL DEFAULT 0,
  rows_skipped    integer      NOT NULL DEFAULT 0,
  period_start    date,
  period_end      date,
  notes           text,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingest_runs_run_at_idx ON public.ingest_runs (run_at DESC);
CREATE INDEX IF NOT EXISTS ingest_runs_source_idx ON public.ingest_runs (source, run_at DESC);

ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ingest_runs_service_rw ON public.ingest_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY ingest_runs_authenticated_read ON public.ingest_runs
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- F24: required grants for service_role write access
GRANT INSERT, UPDATE, DELETE ON public.ingest_runs TO service_role;

COMMENT ON TABLE public.ingest_runs IS
  'One row per CLI bookkeeping ingest execution. Enables the /bookkeeping/reconcile UI to '
  'surface data freshness: "Last ingested: {date} — {N} rows." Written by the ingest script '
  'via service_role. source values: td_pdf, csv, amazon_match, manual.';
