-- 0058: gmail_daily_scan_runs
-- Audit + idempotency table for the Gmail daily scanner cron.
-- One row per cron invocation. status='ok'|'skipped_unconfigured'|'partial'|'error'.
-- Last-successful-run watermark = MAX(finished_at) WHERE status='ok'.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.gmail_daily_scan_runs;

CREATE TABLE public.gmail_daily_scan_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL CHECK (status IN ('ok','skipped_unconfigured','partial','error')),
  messages_fetched     integer NOT NULL DEFAULT 0,
  messages_new         integer NOT NULL DEFAULT 0,
  invoices_classified  integer NOT NULL DEFAULT 0,
  receipts_classified  integer NOT NULL DEFAULT 0,
  statements_classified integer NOT NULL DEFAULT 0,
  errors_count    integer NOT NULL DEFAULT 0,
  error_summary   text
);

CREATE INDEX idx_gmail_daily_scan_runs_finished_at
  ON public.gmail_daily_scan_runs (finished_at DESC)
  WHERE status = 'ok';

CREATE INDEX idx_gmail_daily_scan_runs_started_at
  ON public.gmail_daily_scan_runs (started_at DESC);

ALTER TABLE public.gmail_daily_scan_runs ENABLE ROW LEVEL SECURITY;
-- service_role-only, no policy (matches post-0050 pattern).
