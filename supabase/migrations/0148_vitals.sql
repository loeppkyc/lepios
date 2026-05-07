-- 0142_vitals.sql
-- Health module v1 — vitals (BP, weight, temp, HR, glucose, O2 sat).
-- Streamlit baseline: pages/8_Health.py SH_VITALS sheet.
-- Multi-person via person_handle (LepiOS pattern, see 0010).

CREATE TABLE vitals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle   TEXT        NOT NULL DEFAULT 'colin'
                              CHECK (person_handle IN ('colin', 'megan', 'cora', 'sharon')),
  recorded_on     DATE        NOT NULL,
  vital_type      TEXT        NOT NULL,
  value           NUMERIC     NOT NULL,
  unit            TEXT        NOT NULL DEFAULT '',
  notes           TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vitals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on vitals"
  ON vitals FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX vitals_person_date_idx ON vitals (person_handle, recorded_on DESC);
CREATE INDEX vitals_type_idx ON vitals (vital_type);

CREATE OR REPLACE FUNCTION update_vitals_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER vitals_updated_at
  BEFORE UPDATE ON vitals
  FOR EACH ROW EXECUTE FUNCTION update_vitals_updated_at();
