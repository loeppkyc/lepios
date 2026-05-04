-- 0121_sandbox_process_isolation_remote.sql
-- Slice 4: closes process_isolation sub-system via remote Docker exec.
-- Set SANDBOX_EXEC_URL + SANDBOX_EXEC_SECRET in Vercel env to activate.
-- Falls back to local spawn (process_isolation_not_enforced) when env vars unset.

UPDATE public.harness_components
SET
  completion_pct = 100,
  notes = 'Slice 4: process_isolation sub-system closed via remote Docker exec. Set SANDBOX_EXEC_URL + SANDBOX_EXEC_SECRET in Vercel env to activate. Falls back to local spawn (process_isolation_not_enforced) when env vars unset.',
  updated_at = now()
WHERE id = 'harness:sandbox';
