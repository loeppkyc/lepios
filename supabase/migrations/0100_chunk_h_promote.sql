-- Chunk H migration gate verify - PROMOTE path
-- No-op migration. Safe to merge to main.

DO $$
BEGIN
  RAISE NOTICE 'Chunk H promote-path verify — no-op';
END $$;
