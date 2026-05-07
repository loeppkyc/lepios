-- 0147_cycle_entries.sql
-- Health module v1 — cycle & endo daily entries (Megan's endometriosis monitoring).
-- Streamlit baseline: pages/8_Health.py SH_ENDO sheet.
-- Cross-cycle pattern recognition deferred to v1.1.

CREATE TABLE cycle_entries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle    TEXT        NOT NULL DEFAULT 'megan'
                               CHECK (person_handle IN ('colin', 'megan', 'cora', 'sharon')),
  entry_date       DATE        NOT NULL,
  cycle_day        INT         NULL CHECK (cycle_day IS NULL OR cycle_day BETWEEN 1 AND 60),
  pain_level       INT         NOT NULL CHECK (pain_level BETWEEN 0 AND 10),
  pain_locations   TEXT[]      NOT NULL DEFAULT '{}',
  bloating         INT         NOT NULL DEFAULT 0 CHECK (bloating BETWEEN 0 AND 10),
  energy           INT         NOT NULL DEFAULT 5 CHECK (energy BETWEEN 0 AND 10),
  mood             TEXT        NOT NULL DEFAULT '',
  sleep_quality    INT         NOT NULL DEFAULT 5 CHECK (sleep_quality BETWEEN 0 AND 10),
  bowel_status     TEXT        NOT NULL DEFAULT '',
  foods            TEXT        NOT NULL DEFAULT '',
  supplements      TEXT        NOT NULL DEFAULT '',
  notes            TEXT        NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (person_handle, entry_date)
);

ALTER TABLE cycle_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on cycle_entries"
  ON cycle_entries FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX cycle_entries_person_date_idx ON cycle_entries (person_handle, entry_date DESC);

CREATE OR REPLACE FUNCTION update_cycle_entries_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cycle_entries_updated_at
  BEFORE UPDATE ON cycle_entries
  FOR EACH ROW EXECUTE FUNCTION update_cycle_entries_updated_at();
