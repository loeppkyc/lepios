-- 0070_self_repair_schema.sql
-- self_repair Slice 1: detect→draft→verify→PR for coordinator_await_timeout.
-- Spec: docs/harness/SELF_REPAIR_SPEC.md (approved).
--
-- Sections:
--   1. self_repair_watchlist  — opt-in registry for action types
--   2. self_repair_runs       — one row per attempt, append-only (AD7 GRANT lockdown)
--   3. capability_registry    — 3 new tool.self_repair.* caps (no-op if 0062 already applied)
--   4. agent_capabilities     — 7 grants for self_repair agent_id
--   5. harness_config         — SELF_REPAIR_ENABLED=false, SELF_REPAIR_DAILY_CAP=3
--   6. harness_components     — bump self_repair 0 → 46
--
-- AD2: NEVER auto-merge. Every fix opens a PR; human merges it.
-- AD7: GRANT lockdown — self_repair_runs is append-only for service_role.
--
-- Verify post-apply:
--   SELECT COUNT(*) FROM self_repair_watchlist;   -- expect 1
--   SELECT action_type FROM self_repair_watchlist; -- expect coordinator_await_timeout
--   SELECT COUNT(*) FROM self_repair_runs LIMIT 1; -- expect 0 (empty)
--   SELECT value FROM harness_config WHERE key='SELF_REPAIR_ENABLED'; -- expect false
--   SELECT completion_pct FROM harness_components WHERE id='harness:self_repair'; -- expect 46

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. self_repair_watchlist — explicit opt-in per failure action type (AD4)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.self_repair_watchlist (
  action_type  TEXT        PRIMARY KEY,
  enabled      BOOLEAN     NOT NULL DEFAULT true,
  notes        TEXT,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by     TEXT        NOT NULL DEFAULT 'colin'
);

-- Slice 1 seed: coordinator_await_timeout only (AD4)
INSERT INTO self_repair_watchlist (action_type, enabled, notes, added_by)
VALUES (
  'coordinator_await_timeout',
  true,
  'Slice 1 seed: code-fixable signal (missing handler / too-tight timeout). Low historical noise (2 events). Selected over high-volume drain_trigger_failed because the latter is transient infrastructure, not code.',
  'colin'
) ON CONFLICT (action_type) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. self_repair_runs — one row per attempt (M6 + AD7)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.self_repair_runs (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Detection
  trigger_event_id            UUID         NOT NULL,   -- agent_events.id (no FK — agent_events may not have UUID PK)
  action_type                 TEXT         NOT NULL,   -- mirror of agent_events.action
  detected_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Lifecycle
  status                      TEXT         NOT NULL
    CHECK (status IN (
      'running',
      'context_gathered',
      'draft_failed',
      'drafted',
      'verifying',
      'verify_failed',
      'verify_timeout',
      'verify_passed',
      'pr_opened',
      'pr_open_failed',
      'escalated',
      'cap_exceeded'
    )),
  status_at                   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Drafter outputs
  drafter_prompt_tokens       INTEGER,
  drafter_completion_tokens   INTEGER,
  drafter_summary             TEXT,
  drafter_rationale           TEXT,

  -- Sandbox verifier
  sandbox_run_id              UUID         REFERENCES public.sandbox_runs(id) ON DELETE NO ACTION,
  verify_exit_code            INTEGER,
  verify_duration_ms          INTEGER,
  warnings                    TEXT[]       NOT NULL DEFAULT '{}',   -- from sandbox

  -- PR
  pr_number                   INTEGER,
  pr_url                      TEXT,
  branch_name                 TEXT,

  -- Failure / escalation
  failure_reason              TEXT,   -- when status ends in *_failed / escalated

  -- Cleanup
  cleaned_at                  TIMESTAMPTZ   -- when worktree was torn down
);

CREATE INDEX idx_sr_runs_status ON public.self_repair_runs(status, detected_at DESC);
CREATE INDEX idx_sr_runs_action ON public.self_repair_runs(action_type, detected_at DESC);

ALTER TABLE public.self_repair_runs ENABLE ROW LEVEL SECURITY;

-- AD7 GRANT lockdown: append-only for service_role
REVOKE UPDATE, DELETE ON public.self_repair_runs FROM service_role, authenticated, anon;
GRANT INSERT, SELECT ON public.self_repair_runs TO service_role;
-- Column-level UPDATE for lifecycle progression
GRANT UPDATE (
  status, status_at,
  drafter_prompt_tokens, drafter_completion_tokens,
  drafter_summary, drafter_rationale,
  sandbox_run_id, verify_exit_code, verify_duration_ms, warnings,
  pr_number, pr_url, branch_name,
  failure_reason, cleaned_at
) ON public.self_repair_runs TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. capability_registry — 3 new tool.self_repair.* caps (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- Ensure 'tool' domain is in the constraint (may already be there from 0062 or 0069)
ALTER TABLE capability_registry
  DROP CONSTRAINT IF EXISTS capability_registry_domain_check;
ALTER TABLE capability_registry
  ADD CONSTRAINT capability_registry_domain_check
    CHECK (domain IN ('fs','net','db','shell','git','secret','sandbox','browser','gmail','tool'));

INSERT INTO capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES
  ('tool.self_repair.read.agent_events', 'tool', 'self_repair reads agent_events for failure detection',       'log_only', false),
  ('tool.self_repair.draft_fix',         'tool', 'self_repair calls LLM to draft a fix',                      'log_only', false),
  ('tool.self_repair.open_pr',           'tool', 'self_repair opens a GitHub PR',                              'log_only', true)
ON CONFLICT (capability) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. agent_capabilities — 7 grants for self_repair agent_id (AD6)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES
  ('self_repair', 'tool.self_repair.read.agent_events', 'log_only', 'colin', 'self_repair slice 1 — failure detection'),
  ('self_repair', 'tool.self_repair.draft_fix',         'log_only', 'colin', 'self_repair slice 1 — LLM call to draft a patch'),
  ('self_repair', 'tool.self_repair.open_pr',           'log_only', 'colin', 'self_repair slice 1 — open GitHub PR'),
  ('self_repair', 'net.outbound.anthropic',             'log_only', 'colin', 'self_repair — Sonnet API for fix drafter'),
  ('self_repair', 'net.outbound.github',                'log_only', 'colin', 'self_repair — PR open via arms_legs httpRequest'),
  ('self_repair', 'net.outbound.telegram',              'log_only', 'colin', 'self_repair — notify on PR open / verify failure'),
  ('self_repair', 'sandbox.run',                        'log_only', 'colin', 'self_repair — runInSandbox for verification')
ON CONFLICT (agent_id, capability) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. harness_config — feature flag + daily cap (AD7)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO harness_config (key, value)
VALUES
  ('SELF_REPAIR_ENABLED',   'false'),
  ('SELF_REPAIR_DAILY_CAP', '3')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. harness_components — bump self_repair 0 → 46 (spec §Completion accounting)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.harness_components
SET
  completion_pct = 46,
  notes = 'Slice 1 shipped: detect→draft→verify→PR for coordinator_await_timeout. No auto-merge ever (AD2).',
  updated_at = NOW()
WHERE id = 'harness:self_repair';
