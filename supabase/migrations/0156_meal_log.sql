-- 0156_meal_log.sql
-- Diet module v1 — meal log with calories + macros.
-- Streamlit baseline: pages/83_Grocery_Tracker.py SH_MEAL sheet.
-- AI nutrition estimation (Claude Haiku) deferred to v1.1.

CREATE TABLE meal_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_date       DATE        NOT NULL,
  meal            TEXT        NOT NULL,
  description     TEXT        NOT NULL DEFAULT '',
  calories        INT         NULL,
  protein_g       INT         NULL,
  carbs_g         INT         NULL,
  fat_g           INT         NULL,
  notes           TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meal_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on meal_log"
  ON meal_log FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX meal_log_date_idx ON meal_log (meal_date DESC);

CREATE OR REPLACE FUNCTION update_meal_log_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER meal_log_updated_at
  BEFORE UPDATE ON meal_log
  FOR EACH ROW EXECUTE FUNCTION update_meal_log_updated_at();
