-- 0067_sandbox_layer_schema.sql
-- Depends on 0045 (agent_actions table must exist before this runs)
-- Sandbox Slice 1: workspace isolation + audit trail

CREATE TABLE public.sandbox_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_id       TEXT        NOT NULL,  -- '{agentId}:{worktree_dir_name}' — computed once, pinned (AD5)
  agent_id         TEXT        NOT NULL,
  capability       TEXT        NOT NULL,  -- what was requested (e.g. 'shell.run')
  scope            JSONB       NOT NULL,  -- snapshot of SandboxScope at start

  -- Lifecycle
  status           TEXT        NOT NULL
    CHECK (status IN ('running','completed','failed','denied','timeout','cleaned')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  cleaned_at       TIMESTAMPTZ,
  duration_ms      INTEGER,

  -- Worktree
  worktree_path    TEXT        NOT NULL,  -- absolute path on host; hint, not identifier (AD5)
  base_sha         TEXT        NOT NULL,  -- HEAD at worktree creation — diff base
  cmd              TEXT        NOT NULL,
  cwd              TEXT,

  -- Outputs
  exit_code        INTEGER,              -- null if killed / denied
  timed_out        BOOLEAN     NOT NULL DEFAULT false,
  stdout_truncated TEXT,                 -- capped at 256 KB
  stderr_truncated TEXT,
  files_changed    TEXT[]      NOT NULL DEFAULT '{}',
  diff_stat        JSONB,                -- { insertions, deletions, files }
  diff_hash        TEXT,                 -- sha256 of unified diff
  warnings         TEXT[]      NOT NULL DEFAULT '{}',  -- surfaced to caller (e.g. 'net_isolation_not_enforced')

  -- Audit
  audit_action_id  UUID        REFERENCES public.agent_actions(id) ON DELETE NO ACTION,
  reason           TEXT
);

CREATE INDEX idx_sandbox_runs_agent_started ON public.sandbox_runs (agent_id, started_at DESC);
CREATE INDEX idx_sandbox_runs_status ON public.sandbox_runs (status)
  WHERE status IN ('running', 'denied', 'timeout');

ALTER TABLE public.sandbox_runs ENABLE ROW LEVEL SECURITY;

-- AD7 GRANT lockdown (matches security_layer pattern): append-only for service_role
REVOKE UPDATE, DELETE ON public.sandbox_runs FROM service_role, authenticated, anon;
GRANT INSERT, SELECT ON public.sandbox_runs TO service_role;
-- Exception: cleanupSandbox() needs to mark cleaned_at and status
GRANT UPDATE (cleaned_at, status, ended_at, duration_ms, exit_code, timed_out,
              stdout_truncated, stderr_truncated, files_changed, diff_stat,
              diff_hash, warnings, audit_action_id) ON public.sandbox_runs TO service_role;

-- Rollup bump: slice 1 ships worktree runtime + fs-diff + audit; slice 2 lifts to 65
UPDATE public.harness_components
SET    completion_pct = 50,
       notes = 'Slice 1 shipped: worktree runtime + fs-diff + audit. Slice 2 pending: boundary_check_wired.'
WHERE  id = 'harness:sandbox';
