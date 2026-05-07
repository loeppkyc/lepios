-- 0143_symptoms.sql
-- Health module v1 — symptoms (headache, fatigue, etc.) with active/resolved tracking.
-- Streamlit baseline: pages/8_Health.py SH_SYMPTOMS sheet.
-- Active = resolved_on IS NULL.

CREATE TABLE symptoms (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle   TEXT        NOT NULL DEFAULT 'colin'
                              CHECK (person_handle IN ('colin', 'megan', 'cora', 'sharon')),
  started_on      DATE        NOT NULL,
  symptom         TEXT        NOT NULL,
  severity        INT         NOT NULL CHECK (severity BETWEEN 1 AND 10),
  duration        TEXT        NOT NULL DEFAULT '',
  resolved_on     DATE        NULL,
  notes           TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE symptoms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on symptoms"
  ON symptoms FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX symptoms_person_started_idx ON symptoms (person_handle, started_on DESC);
CREATE INDEX symptoms_active_idx ON symptoms (person_handle) WHERE resolved_on IS NULL;

CREATE OR REPLACE FUNCTION update_symptoms_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER symptoms_updated_at
  BEFORE UPDATE ON symptoms
  FOR EACH ROW EXECUTE FUNCTION update_symptoms_updated_at();
