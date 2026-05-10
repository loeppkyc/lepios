-- MID batch 2: persist Dropbox audit results so re-run isn't required every visit

CREATE TABLE IF NOT EXISTS public.dropbox_audit_runs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cutoff_days      int         NOT NULL DEFAULT 90,
  used_gb          numeric(8,3),
  quota_gb         numeric(8,3),
  pct_used         numeric(5,2),
  archiveable_total int,
  already_local    int,
  need_download    int,
  need_download_gb numeric(8,3),
  ran_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dropbox_audit_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY dropbox_audit_runs_self
  ON public.dropbox_audit_runs FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT INSERT, UPDATE, DELETE ON public.dropbox_audit_runs TO service_role;
