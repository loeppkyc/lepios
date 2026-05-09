-- 0166_decisions_log_f19_state.sql
-- F19' Slice 1: add metadata jsonb column + f19_loop source value

-- Step 1: add metadata column (IF NOT EXISTS — idempotent)
ALTER TABLE decisions_log ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Step 2: extend source CHECK to include f19_loop
-- Must drop + recreate because PostgreSQL CHECK constraints cannot be altered in place
ALTER TABLE decisions_log DROP CONSTRAINT decisions_log_source_check;
ALTER TABLE decisions_log ADD CONSTRAINT decisions_log_source_check
  CHECK (source = ANY (ARRAY[
    'redline_session',
    'morning_digest_response',
    'incident_response',
    'post_mortem',
    'f19_loop'
  ]));
