-- 0158_biomarkers.sql
-- Diet module v1 — blood biomarkers with reference ranges.
-- Streamlit baseline: pages/83_Grocery_Tracker.py SH_BIOMARKER sheet.
-- Status auto-derives at INSERT time from value vs ref_low/ref_high
-- (instead of free-text typed by user — Streamlit gotcha).

CREATE TABLE biomarkers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_on     DATE        NOT NULL,
  marker          TEXT        NOT NULL,
  value           NUMERIC     NOT NULL,
  unit            TEXT        NOT NULL DEFAULT '',
  ref_low         NUMERIC     NULL,
  ref_high        NUMERIC     NULL,
  status          TEXT        NOT NULL DEFAULT 'unknown'
                              CHECK (status IN ('low', 'normal', 'high', 'unknown')),
  notes           TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE biomarkers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on biomarkers"
  ON biomarkers FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX biomarkers_marker_date_idx ON biomarkers (marker, recorded_on DESC);
CREATE INDEX biomarkers_date_idx ON biomarkers (recorded_on DESC);

-- Auto-derive status from value vs ref range, on INSERT and UPDATE.
CREATE OR REPLACE FUNCTION derive_biomarker_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ref_low IS NULL AND NEW.ref_high IS NULL THEN
    NEW.status = 'unknown';
  ELSIF NEW.ref_low IS NOT NULL AND NEW.value < NEW.ref_low THEN
    NEW.status = 'low';
  ELSIF NEW.ref_high IS NOT NULL AND NEW.value > NEW.ref_high THEN
    NEW.status = 'high';
  ELSE
    NEW.status = 'normal';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER biomarkers_derive_status
  BEFORE INSERT OR UPDATE ON biomarkers
  FOR EACH ROW EXECUTE FUNCTION derive_biomarker_status();
