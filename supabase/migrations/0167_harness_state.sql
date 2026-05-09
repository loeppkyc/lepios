-- 0167_harness_state.sql
-- Seeds HARNESS_STATE and HARNESS_STATE_CHANGED_AT in harness_config.
-- Initial value: IDLE (nothing running, not halted).
-- readHarnessState() in lib/harness/harness-state.ts upserts these on state transitions.

INSERT INTO public.harness_config (key, value)
VALUES
  ('HARNESS_STATE',            'IDLE'),
  ('HARNESS_STATE_CHANGED_AT', now()::text)
ON CONFLICT (key) DO NOTHING;
