-- push_bash_automation Slice 1: decision engine + audit table

CREATE TABLE public.push_bash_decisions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cmd           TEXT        NOT NULL,
  tier          TEXT        NOT NULL CHECK (tier IN ('auto', 'confirm', 'block')),
  reason        TEXT        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('auto_executed', 'pending', 'approved', 'denied', 'blocked', 'timed_out')),
  sandbox_run_id UUID       REFERENCES public.sandbox_runs(id) ON DELETE SET NULL,
  exit_code     INTEGER,
  stdout_trunc  TEXT,
  stderr_trunc  TEXT,
  agent_id      TEXT,
  context       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX idx_push_bash_tier_status ON public.push_bash_decisions (tier, status);
CREATE INDEX idx_push_bash_created ON public.push_bash_decisions (created_at DESC);

ALTER TABLE public.push_bash_decisions ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT ON public.push_bash_decisions TO service_role;

UPDATE public.harness_components
SET
  completion_pct = 50,
  notes = 'Slice 1 shipped: decideAction() policy engine, executeDecision() executor, POST /api/harness/push-bash. Audit trail in push_bash_decisions. Confirm tier sends plain Telegram (no buttons yet — Slice 2). Block patterns enforce destructive-op safety.',
  updated_at = now()
WHERE id = 'harness:push_bash_automation';
