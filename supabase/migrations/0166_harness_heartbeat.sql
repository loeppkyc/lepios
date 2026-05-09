-- 0166_harness_heartbeat.sql
--
-- Seeds LAST_HEARTBEAT_AT in harness_config for the dead-man's-switch.
-- Every night_tick run UPSERTs this key. /api/health/lease reads it.
--
-- NOTE: service_role GRANTs (INSERT, UPDATE, DELETE) on harness_config
-- were granted by migration 0165 — F-N20 lesson applied there.
-- No new GRANTs required here; they carry forward automatically.
--
-- Stored as ISO-8601 text (harness_config.value is text). Endpoint parses
-- via CAST(value AS timestamptz) in SQL or new Date(value) in TypeScript.

INSERT INTO harness_config (key, value)
VALUES ('LAST_HEARTBEAT_AT', now()::text)
ON CONFLICT (key) DO NOTHING;

-- Verify the row exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM harness_config WHERE key = 'LAST_HEARTBEAT_AT'
  ) THEN
    RAISE EXCEPTION '0166: LAST_HEARTBEAT_AT seed missing from harness_config';
  END IF;
END $$;
