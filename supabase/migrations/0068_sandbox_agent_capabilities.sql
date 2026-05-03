-- 0068_sandbox_agent_capabilities.sql
-- Seeds agent_capabilities rows so builder + coordinator can call runInSandbox().
-- capability_registry already has sandbox.create, sandbox.execute, sandbox.run, sandbox.escape (0045 + 0062).
-- Enforcement mode 'log_only' matches the registry default — no hard denials yet.

INSERT INTO public.agent_capabilities (agent_id, capability, enforcement_mode, granted_by, notes)
VALUES
  -- builder: can create and execute sandboxes
  ('builder', 'sandbox.create',  'log_only', 'migration_0068', 'Slice 2: builder creates ephemeral worktrees'),
  ('builder', 'sandbox.execute', 'log_only', 'migration_0068', 'Slice 2: builder runs commands in worktree'),
  ('builder', 'sandbox.run',     'log_only', 'migration_0068', 'Slice 2: alias for execute (0062 registry entry)'),
  ('builder', 'sandbox.escape',  'log_only', 'migration_0068', 'Slice 2: builder promotes worktree diff to PR'),
  -- coordinator: can create sandboxes (delegates execution to builder)
  ('coordinator', 'sandbox.create', 'log_only', 'migration_0068', 'Slice 2: coordinator may delegate sandbox creation')
ON CONFLICT (agent_id, capability) DO NOTHING;

-- Bump rollup: slice 2 ships boundary_check_wired (15% internal weight → 65% total)
UPDATE public.harness_components
SET    completion_pct = 65,
       notes = 'Slice 2 shipped: checkSandboxAction wired, agent_capabilities seeded, orphan GC in night-tick. Slice 3 pending: Docker process isolation.'
WHERE  id = 'harness:sandbox';
