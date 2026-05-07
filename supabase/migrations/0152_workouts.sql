-- 0146_workouts.sql
-- Health module v1 — workouts (exercise + muscle groups + intensity).
-- Streamlit baseline: pages/8_Health.py SH_WORKOUTS sheet.
-- Supercompensation gauge math (calc_muscle_fitness) deferred to v1.1.

CREATE TABLE workouts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle   TEXT        NOT NULL DEFAULT 'colin'
                              CHECK (person_handle IN ('colin', 'megan', 'cora', 'sharon')),
  workout_date    DATE        NOT NULL,
  exercise        TEXT        NOT NULL,
  muscle_groups   TEXT[]      NOT NULL DEFAULT '{}',
  intensity       INT         NOT NULL CHECK (intensity BETWEEN 1 AND 10),
  notes           TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on workouts"
  ON workouts FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX workouts_person_date_idx ON workouts (person_handle, workout_date DESC);

CREATE OR REPLACE FUNCTION update_workouts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER workouts_updated_at
  BEFORE UPDATE ON workouts
  FOR EACH ROW EXECUTE FUNCTION update_workouts_updated_at();
