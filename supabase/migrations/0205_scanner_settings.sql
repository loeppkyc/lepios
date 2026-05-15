-- 0205_scanner_settings.sql
-- Per-user scanner thresholds. Currently single-row for 'colin'; SPRINT5-GATE tighten to profiles FK.

CREATE TABLE public.scanner_settings (
  person_handle  TEXT PRIMARY KEY DEFAULT 'colin',
  min_profit_cad NUMERIC(6,2) NOT NULL DEFAULT 3.00,
  min_roi_pct    NUMERIC(5,1) NOT NULL DEFAULT 50.0,
  max_bsr        INTEGER      NOT NULL DEFAULT 0, -- 0 = no BSR gate
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.scanner_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scanner_settings_authenticated"
  ON public.scanner_settings
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Seed default row for colin
INSERT INTO public.scanner_settings (person_handle, min_profit_cad, min_roi_pct, max_bsr)
VALUES ('colin', 3.00, 50.0, 0);

GRANT INSERT, UPDATE, DELETE ON public.scanner_settings TO service_role;
