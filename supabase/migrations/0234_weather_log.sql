-- 0232_weather_log.sql
-- Behavioral ingestion: hourly weather logging via Open-Meteo (no API key required).
-- Sprint 10 Chunk D
--
-- Schema:
--   weather_log — one row per hourly weather snapshot for Edmonton, AB

CREATE TABLE weather_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  temp_c REAL,
  feels_like_c REAL,
  condition TEXT,
  humidity INTEGER,
  wind_kph REAL,
  location TEXT DEFAULT 'Edmonton, AB'
);

-- Index for recent-first queries and time-range aggregation
CREATE INDEX weather_log_recorded_at_idx ON weather_log(recorded_at DESC);

-- Service role write access (F24)
GRANT INSERT, UPDATE, DELETE ON weather_log TO service_role;

-- Authenticated read
ALTER TABLE weather_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY weather_log_authenticated_read ON weather_log
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY weather_log_service_write ON weather_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
