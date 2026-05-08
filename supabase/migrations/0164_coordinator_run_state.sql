-- Migration 0164 — coordinator_run_state
-- T-001 v2: continuous-mode run tracking for self-prioritization, done-state auto-draft,
-- and quota-aware halting. Each /run continuous or /queue run continuous creates one row.
-- Rows accumulate; status transitions: running → halted_quota | halted_manual | complete.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE coordinator_run_state (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                  TEXT        NOT NULL DEFAULT 'continuous',
  status                TEXT        NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running','halted_quota','halted_manual','complete')),

  -- Progress tracking
  modules_shipped       TEXT[]      NOT NULL DEFAULT '{}',
  modules_shipped_count INT         NOT NULL DEFAULT 0,
  modules_attempted_count INT       NOT NULL DEFAULT 0,

  -- Current work
  current_target        TEXT,
  current_task_id       UUID        REFERENCES task_queue(id),

  -- Quota tracking
  quota_pct_at_start    NUMERIC(5,2),
  quota_pct_at_halt     NUMERIC(5,2),
  last_quota_check_at   TIMESTAMPTZ,

  -- Done-state draft tracking
  done_states_drafted   TEXT[]      NOT NULL DEFAULT '{}',

  -- Timestamps
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  halted_at             TIMESTAMPTZ,
  resumed_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  telegram_sent_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One running row max — enforced by application, not DB, to allow manual overrides.
-- updated_at trigger
CREATE OR REPLACE FUNCTION coordinator_run_state_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER coordinator_run_state_updated_at
  BEFORE UPDATE ON coordinator_run_state
  FOR EACH ROW EXECUTE FUNCTION coordinator_run_state_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE coordinator_run_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read write coordinator_run_state"
  ON coordinator_run_state FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- service_role: full access (coordinator writes from server-side)
GRANT SELECT, INSERT, UPDATE ON coordinator_run_state TO service_role;

-- ── harness_config seeds ──────────────────────────────────────────────────────

INSERT INTO harness_config (key, value, description) VALUES
  ('HARNESS_QUOTA_THRESHOLD',    '85', 'Anthropic/routines usage % at which continuous mode halts'),
  ('HARNESS_CONTINUOUS_RUN_ID',  '',   'coordinator_run_state.id of the active continuous run; empty when idle'),
  ('HARNESS_QUOTA_TOKENS_USED',  '0',  'Cumulative tokens consumed by harness this billing period'),
  ('HARNESS_QUOTA_TOKENS_LIMIT', '1000000', 'Configured token budget for the period (default 1M)')
ON CONFLICT (key) DO NOTHING;
