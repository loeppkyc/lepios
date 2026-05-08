-- 0162_safety_agent_v2.sql
-- T-002 Safety Agent v2 — Sub-phase A foundation.
--
-- Three additions:
--   1. task_queue.plan_loc — declared LOC budget for scope-creep signal.
--   2. safety_decisions — per-PR audit trail (signals breakdown + action).
--   3. harness_config seed rows — signal weights + tier thresholds.
--
-- Spec: docs/leverage-targets.md#safety-agent-0--done
-- Audit: docs/lepios/safety-agent-audit.md
--
-- Verify post-apply:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'task_queue' AND column_name = 'plan_loc';
--   SELECT to_regclass('public.safety_decisions');
--   SELECT key FROM harness_config WHERE key LIKE 'SAFETY_%' ORDER BY key;

-- ── 1. task_queue.plan_loc ──────────────────────────────────────────────────
-- Coordinator populates this when writing the acceptance doc. NULL means
-- "no plan_loc provided" → scope-creep signal scores 0 (no false positives).

ALTER TABLE public.task_queue
  ADD COLUMN IF NOT EXISTS plan_loc INTEGER NULL
    CHECK (plan_loc IS NULL OR plan_loc > 0);

COMMENT ON COLUMN public.task_queue.plan_loc IS
  'Declared LOC budget for the task. Safety Agent compares actual PR LOC vs plan_loc * 2 for the scope-creep signal. NULL = no plan, signal scores 0.';

-- ── 2. safety_decisions ─────────────────────────────────────────────────────
-- Per-PR audit trail. One row per Safety Agent invocation. Signals breakdown
-- captured as JSONB so weight tuning can replay historical scores.

CREATE TABLE public.safety_decisions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  decided_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- PR identity
  commit_sha   TEXT         NOT NULL,
  branch       TEXT         NOT NULL,
  pr_number    INTEGER,
  task_id      UUID         REFERENCES public.task_queue(id) ON DELETE SET NULL,

  -- Score + breakdown
  risk_score   SMALLINT     NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  tier         TEXT         NOT NULL
               CHECK (tier IN ('low', 'medium', 'high')),
  signals      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  e2e_pass     BOOLEAN,
  e2e_failures JSONB        NOT NULL DEFAULT '[]'::jsonb,

  -- Routing outcome
  action       TEXT         NOT NULL
               CHECK (action IN (
                 'auto_merge',          -- low + e2e pass
                 'twin_proceed',        -- medium + twin returned PROCEED
                 'twin_hold',           -- medium + twin returned HOLD (retry-after-24h)
                 'twin_escalate',       -- medium + twin returned ESCALATE
                 'colin_escalate',      -- high or e2e fail (skip twin)
                 'twin_unavailable'     -- twin unreachable; fail-safe escalate
               )),
  twin_response JSONB,                  -- raw twin output when consulted
  notes         TEXT
);

CREATE INDEX safety_decisions_commit_idx
  ON public.safety_decisions (commit_sha);

CREATE INDEX safety_decisions_decided_at_idx
  ON public.safety_decisions (decided_at DESC);

CREATE INDEX safety_decisions_action_idx
  ON public.safety_decisions (action, decided_at DESC);

ALTER TABLE public.safety_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "safety_decisions_authenticated" ON public.safety_decisions
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE public.safety_decisions IS
  'Per-PR audit trail for the Safety Agent. One row per invocation. signals JSONB lets us replay scores after weight tuning. See docs/leverage-targets.md#safety-agent-0--done.';

COMMENT ON COLUMN public.safety_decisions.signals IS
  'Array of {name, weight, evidence}. e.g. [{"name":"secret_detected","weight":100,"evidence":"+AWS_KEY=AKIA…"}]. Signals contributing 0 may be omitted.';

COMMENT ON COLUMN public.safety_decisions.e2e_pass IS
  'Puppeteer E2E result. NULL = not run (no surface URLs in done_state). FALSE = automatic ESCALATE regardless of score.';

-- ── 3. harness_config seed — weights + thresholds ───────────────────────────
-- Per Q-003 calibration table in docs/leverage-targets.md.
-- Observe-only for 7 days, then tune. Same playbook as DEPLOY_GATE_RISK_TIER.

INSERT INTO public.harness_config (key, value, is_secret) VALUES
  -- Per-signal weights (number stored as text — read site casts to int).
  ('SAFETY_WEIGHT_SECRET_DETECTED',           '100', false),
  ('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE',     '60',  false),
  ('SAFETY_WEIGHT_MIGRATION_ADDITIVE',        '10',  false),
  ('SAFETY_WEIGHT_COVERAGE_DROP_5PCT',        '30',  false),
  ('SAFETY_WEIGHT_COVERAGE_DROP_15PCT',       '60',  false),
  ('SAFETY_WEIGHT_LOC_DELTA_2X',              '20',  false),
  ('SAFETY_WEIGHT_FAILURE_PATTERN_LOW',       '25',  false),
  ('SAFETY_WEIGHT_FAILURE_PATTERN_HIGH',      '50',  false),
  ('SAFETY_WEIGHT_SHARED_SEAM_TOUCH',         '40',  false),
  ('SAFETY_WEIGHT_API_ROUTE_NETNEW',          '15',  false),
  ('SAFETY_WEIGHT_BASE',                      '5',   false),
  -- Tier thresholds (low <X, medium X..Y, high >Y).
  ('SAFETY_THRESHOLD_LOW_MAX',                '29',  false),
  ('SAFETY_THRESHOLD_MEDIUM_MAX',             '70',  false)
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN public.harness_config.value IS
  'String value. Numeric configs (SAFETY_WEIGHT_*, SAFETY_THRESHOLD_*) cast at read site.';
