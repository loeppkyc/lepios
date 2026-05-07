-- 0145_doctor_visits.sql
-- Health module v1 — doctor visits with diagnosis/outcome/follow-up.
-- Streamlit baseline: pages/8_Health.py SH_VISITS sheet.

CREATE TABLE doctor_visits (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle    TEXT        NOT NULL DEFAULT 'colin'
                               CHECK (person_handle IN ('colin', 'megan', 'cora', 'sharon')),
  visit_date       DATE        NOT NULL,
  doctor_name      TEXT        NOT NULL,
  specialty        TEXT        NOT NULL DEFAULT '',
  clinic           TEXT        NOT NULL DEFAULT '',
  reason           TEXT        NOT NULL DEFAULT '',
  diagnosis        TEXT        NOT NULL DEFAULT '',
  outcome          TEXT        NOT NULL DEFAULT '',
  follow_up_date   DATE        NULL,
  notes            TEXT        NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE doctor_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on doctor_visits"
  ON doctor_visits FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX doctor_visits_person_date_idx ON doctor_visits (person_handle, visit_date DESC);
CREATE INDEX doctor_visits_followup_idx ON doctor_visits (person_handle, follow_up_date)
  WHERE follow_up_date IS NOT NULL;

CREATE OR REPLACE FUNCTION update_doctor_visits_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER doctor_visits_updated_at
  BEFORE UPDATE ON doctor_visits
  FOR EACH ROW EXECUTE FUNCTION update_doctor_visits_updated_at();
