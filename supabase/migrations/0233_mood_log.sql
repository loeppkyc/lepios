-- 0231_mood_log.sql
-- Behavioral ingestion: mood logging via Telegram daily prompt.
-- Sprint 10 Chunk D
--
-- Schema:
--   mood_log — one row per Colin mood check-in
--   source = 'telegram' (default) | 'manual'

CREATE TABLE mood_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  energy INTEGER NOT NULL CHECK (energy BETWEEN 1 AND 5),
  focus INTEGER CHECK (focus BETWEEN 1 AND 5),
  notes TEXT,
  source TEXT DEFAULT 'telegram'
);

-- Index for recent-first queries (morning digest, correlation with trading picks)
CREATE INDEX mood_log_logged_at_idx ON mood_log(logged_at DESC);

-- Service role write access (F24)
GRANT INSERT, UPDATE, DELETE ON mood_log TO service_role;

-- Authenticated users can read their own entries
ALTER TABLE mood_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY mood_log_authenticated_read ON mood_log
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY mood_log_service_write ON mood_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
