-- 0157_weight_log.sql
-- Diet module v1 — daily weight log.
-- Streamlit baseline: pages/83_Grocery_Tracker.py SH_WEIGHT sheet.
-- TDEE projection bar deferred to v1.1.
-- UNIQUE(weighed_on) so re-logging the same day upserts atomically (Streamlit appends duplicates — bug avoided here).

CREATE TABLE weight_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  weighed_on      DATE        NOT NULL UNIQUE,
  weight_lbs      NUMERIC(5,1) NOT NULL,
  notes           TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE weight_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on weight_log"
  ON weight_log FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX weight_log_date_idx ON weight_log (weighed_on DESC);

CREATE OR REPLACE FUNCTION update_weight_log_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER weight_log_updated_at
  BEFORE UPDATE ON weight_log
  FOR EACH ROW EXECUTE FUNCTION update_weight_log_updated_at();
