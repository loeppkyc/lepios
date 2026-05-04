-- debate_consensus Slice 1: consensus_runs table + capability grant + completion bump

-- 1. Audit table
CREATE TABLE public.consensus_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt          TEXT        NOT NULL,
  consensus_level TEXT        CHECK (consensus_level IN ('full', 'majority', 'split')),
  answer          TEXT,
  splits          TEXT[]      NOT NULL DEFAULT '{}',
  outliers        TEXT[]      NOT NULL DEFAULT '{}',
  raw_perspectives JSONB,
  raw_consensus   TEXT,
  duration_ms     INTEGER,
  agent_id        TEXT,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consensus_runs_created ON public.consensus_runs (created_at DESC);
CREATE INDEX idx_consensus_runs_level ON public.consensus_runs (consensus_level);

ALTER TABLE public.consensus_runs ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT ON public.consensus_runs TO service_role;

-- 2. Capability grant for consensus agent_id
INSERT INTO public.agent_capabilities (agent_id, capability, enforcement_mode, granted_by, notes)
VALUES
  ('consensus', 'net.outbound.anthropic', 'log_only', 'colin',
   'consensus — 3x Sonnet fan-out + 1x Opus fan-in for debate pipeline')
ON CONFLICT (agent_id, capability) DO NOTHING;

-- 3. Bump completion
UPDATE public.harness_components
SET
  completion_pct = 50,
  notes = 'Slice 1 shipped: runConsensus() 3+1 pipeline, POST /api/harness/consensus, consensus_runs audit table. Slice 2: wire into coordinator accept-doc approval and deploy_gate decision points.',
  updated_at = now()
WHERE id = 'harness:debate_consensus';
