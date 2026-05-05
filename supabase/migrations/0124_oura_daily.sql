-- 0124_oura_daily.sql
-- Oura Ring daily health metrics store.
-- Synced nightly from Oura API v2 via /api/cron/oura-sync.
-- Token stored in harness_config key 'OURA_TOKEN'.
--
-- Metrics sourced from:
--   daily_sleep, daily_readiness, daily_activity, sleep endpoints.
-- Duration fields stored in display units (hours/minutes) to match Streamlit baseline.
--
-- Verify post-apply:
--   SELECT * FROM oura_daily LIMIT 1;

CREATE TABLE oura_daily (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE        NOT NULL UNIQUE,

  -- Oura score trifecta (0–100 each)
  sleep_score       INT,
  readiness_score   INT,
  activity_score    INT,

  -- Sleep detail
  total_sleep_hours NUMERIC(4,2),  -- converted from seconds
  deep_sleep_min    INT,           -- deep sleep in minutes
  rem_sleep_min     INT,
  light_sleep_min   INT,

  -- Physiology
  hrv               NUMERIC(6,2),  -- average HRV in ms
  resting_hr        INT,           -- bpm

  -- Activity
  steps             INT,

  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: Colin (authenticated) can read; service role syncs.
ALTER TABLE oura_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can read oura_daily"
  ON oura_daily FOR SELECT
  TO authenticated
  USING (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_oura_daily_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER oura_daily_updated_at
  BEFORE UPDATE ON oura_daily
  FOR EACH ROW EXECUTE FUNCTION update_oura_daily_updated_at();

-- Index for date range queries (health trends)
CREATE INDEX oura_daily_date_idx ON oura_daily (date DESC);
