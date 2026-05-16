-- 0219_pet_health.sql
-- E1 — Pet Health Centre
-- Four tables: pets, vet_visits, pet_vaccinations, pet_medications
-- See docs/backlog/tier-e/E1-acceptance.md

-- pets
CREATE TABLE pets (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle  TEXT         NOT NULL DEFAULT 'colin'
                              CHECK (person_handle IN ('colin', 'megan', 'cora', 'shared')),
  name           TEXT         NOT NULL,
  species        TEXT         NOT NULL CHECK (species IN ('cat', 'dog', 'other')),
  breed          TEXT         NOT NULL DEFAULT '',
  dob            DATE         NULL,
  weight_lbs     NUMERIC(5,1) NULL,
  colour         TEXT         NOT NULL DEFAULT '',
  microchip      TEXT         NOT NULL DEFAULT '',
  fixed          TEXT         NOT NULL DEFAULT 'unknown' CHECK (fixed IN ('yes', 'no', 'unknown')),
  notes          TEXT         NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- vet_visits
CREATE TABLE vet_visits (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id         UUID         NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  visit_date     DATE         NOT NULL,
  clinic         TEXT         NOT NULL DEFAULT '',
  vet_name       TEXT         NOT NULL DEFAULT '',
  reason         TEXT         NOT NULL DEFAULT '',
  diagnosis      TEXT         NOT NULL DEFAULT '',
  treatment      TEXT         NOT NULL DEFAULT '',
  follow_up_date DATE         NULL,
  cost_cad       NUMERIC(8,2) NULL,
  notes          TEXT         NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- pet_vaccinations
CREATE TABLE pet_vaccinations (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id         UUID         NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  given_date     DATE         NOT NULL,
  vaccine        TEXT         NOT NULL,
  next_due_date  DATE         NULL,
  clinic         TEXT         NOT NULL DEFAULT '',
  notes          TEXT         NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- pet_medications
CREATE TABLE pet_medications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id          UUID        NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  medication      TEXT        NOT NULL,
  dosage          TEXT        NOT NULL DEFAULT '',
  frequency       TEXT        NOT NULL DEFAULT '',
  start_date      DATE        NOT NULL,
  end_date        DATE        NULL,
  prescribing_vet TEXT        NOT NULL DEFAULT '',
  notes           TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE pets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vet_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE pet_vaccinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pet_medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access" ON pets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON vet_visits
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON pet_vaccinations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated full access" ON pet_medications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- F24 grants
GRANT INSERT, UPDATE, DELETE ON pets TO service_role;
GRANT INSERT, UPDATE, DELETE ON vet_visits TO service_role;
GRANT INSERT, UPDATE, DELETE ON pet_vaccinations TO service_role;
GRANT INSERT, UPDATE, DELETE ON pet_medications TO service_role;
