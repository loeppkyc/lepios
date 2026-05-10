-- Family Dashboard tables: cleaning_clients, cora_activities, family_important_dates
-- See docs/acceptance/mid-batch-family.md

CREATE TABLE IF NOT EXISTS cleaning_clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  address     TEXT,
  frequency   TEXT NOT NULL CHECK (frequency IN ('Weekly','Biweekly','Monthly','One-time')),
  rate        NUMERIC(10,2) NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Paused')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cora_activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  day_of_week  TEXT CHECK (day_of_week IN
                 ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  time_of_day  TEXT,
  monthly_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_important_dates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event      TEXT NOT NULL,
  date       DATE NOT NULL,
  recurring  BOOLEAN NOT NULL DEFAULT false,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

GRANT INSERT, UPDATE, DELETE ON cleaning_clients TO service_role;
GRANT INSERT, UPDATE, DELETE ON cora_activities TO service_role;
GRANT INSERT, UPDATE, DELETE ON family_important_dates TO service_role;
