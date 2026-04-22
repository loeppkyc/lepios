-- Chunk H migration rollback verify
-- No-op migration.

DO $$
BEGIN
  RAISE NOTICE 'Chunk H rollback-path verify — no-op';
END $$;
