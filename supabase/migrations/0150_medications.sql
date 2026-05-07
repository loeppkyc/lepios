-- 0144_medications.sql
-- Health module v1 — medications and supplements.
-- Streamlit baseline: pages/8_Health.py SH_MEDS sheet.
-- Active boolean + start_date/end_date. Stop = active=false + end_date=today.

CREATE TABLE medications (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle      TEXT        NOT NULL DEFAULT 'colin'
                                 CHECK (person_handle IN ('colin', 'megan', 'cora', 'sharon')),
  medication         TEXT        NOT NULL,
  dosage             TEXT        NOT NULL DEFAULT '',
  frequency          TEXT        NOT NULL DEFAULT '',
  start_date         DATE        NOT NULL,
  end_date           DATE        NULL,
  prescribing_doctor TEXT        NOT NULL DEFAULT '',
  pharmacy           TEXT        NOT NULL DEFAULT '',
  active             BOOLEAN     NOT NULL DEFAULT TRUE,
  notes              TEXT        NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on medications"
  ON medications FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX medications_person_active_idx ON medications (person_handle, active);
CREATE INDEX medications_person_start_idx ON medications (person_handle, start_date DESC);

CREATE OR REPLACE FUNCTION update_medications_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER medications_updated_at
  BEFORE UPDATE ON medications
  FOR EACH ROW EXECUTE FUNCTION update_medications_updated_at();
