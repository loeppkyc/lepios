-- 0140_night_watchman.sql
-- Night-Watchman v2 — self-repair scanner persistence layer.
-- Spec: Phase 1 audit deliverable on branch feat/self-repair-night-watchman-v2.
--
-- Three tables, all admin-only RLS (harness internals — same tier as
-- self_repair_runs, agent_events, knowledge):
--   1. night_watchman_runs           — one row per scanner invocation
--   2. night_watchman_check_results  — one row per check executed within a run
--   3. night_watchman_incidents      — open/close lifecycle for problems detected
--
-- Plus four harness_config rows for the killswitch + loop guards.
--
-- Verify post-apply:
--   SELECT count(*) FROM night_watchman_runs;            -- 0
--   SELECT count(*) FROM night_watchman_check_results;   -- 0
--   SELECT count(*) FROM night_watchman_incidents;       -- 0
--   SELECT key,value FROM harness_config WHERE key LIKE 'NW_%' OR key='SELF_REPAIR_HALTED';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. night_watchman_runs — one row per cron firing
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.night_watchman_runs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  scope           TEXT         NOT NULL CHECK (scope IN ('sleep_window', 'daytime', 'manual')),
  trigger_source  TEXT         NOT NULL DEFAULT 'cron' CHECK (trigger_source IN ('cron', 'manual', 'telegram')),
  status_summary  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- summary structure: { ok, warn, fail, skipped, repaired, escalated, halted }
  total_checks    INT          NOT NULL DEFAULT 0,
  total_repairs   INT          NOT NULL DEFAULT 0,
  total_incidents INT          NOT NULL DEFAULT 0,
  notes           TEXT
);

CREATE INDEX night_watchman_runs_started_at_idx
  ON public.night_watchman_runs(started_at DESC);

ALTER TABLE public.night_watchman_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY night_watchman_runs_admin_all
  ON public.night_watchman_runs FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON TABLE public.night_watchman_runs IS
  'Night-watchman scan invocations. One row per cron firing. status_summary jsonb has {ok,warn,fail,skipped,repaired,escalated,halted} counts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. night_watchman_check_results — one row per check execution
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.night_watchman_check_results (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID         NOT NULL REFERENCES public.night_watchman_runs(id) ON DELETE CASCADE,
  check_key         TEXT         NOT NULL,    -- e.g. 'health.api', 'data.knowledge_dedup'
  category          TEXT         NOT NULL CHECK (category IN ('health','errors','security','data','cost','performance')),
  status            TEXT         NOT NULL CHECK (status IN ('ok','warn','fail','skipped')),
  severity          TEXT         CHECK (severity IS NULL OR severity IN ('low','medium','high','critical')),
  evidence_json     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  repair_attempted  BOOLEAN      NOT NULL DEFAULT false,
  repair_outcome    TEXT         CHECK (repair_outcome IS NULL OR repair_outcome IN ('success','failure','not_applicable','escalated','sandbox_pr_opened')),
  repair_evidence   JSONB,
  duration_ms       INT,
  occurred_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX night_watchman_check_results_run_idx
  ON public.night_watchman_check_results(run_id);
CREATE INDEX night_watchman_check_results_status_idx
  ON public.night_watchman_check_results(status, occurred_at DESC);
CREATE INDEX night_watchman_check_results_check_key_idx
  ON public.night_watchman_check_results(check_key, occurred_at DESC);

ALTER TABLE public.night_watchman_check_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY night_watchman_check_results_admin_all
  ON public.night_watchman_check_results FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON TABLE public.night_watchman_check_results IS
  'One row per check execution within a run. Drives status grid + 90-day bars in /self-repair.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. night_watchman_incidents — open/close lifecycle for problems
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.night_watchman_incidents (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  check_key            TEXT         NOT NULL,
  category             TEXT         NOT NULL CHECK (category IN ('health','errors','security','data','cost','performance')),
  severity             TEXT         NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  opened_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  closed_at            TIMESTAMPTZ,
  root_cause           TEXT,
  repairs_attempted    INT          NOT NULL DEFAULT 0,
  resolution           TEXT         CHECK (resolution IS NULL OR resolution IN ('auto_repaired','sandbox_pr','human_resolved','timed_out','superseded')),
  resolution_evidence  JSONB,
  telegram_message_ids INT[]        NOT NULL DEFAULT ARRAY[]::INT[],
  first_check_id       UUID         REFERENCES public.night_watchman_check_results(id) ON DELETE SET NULL,
  last_check_id        UUID         REFERENCES public.night_watchman_check_results(id) ON DELETE SET NULL
);

-- Partial index — finding currently-open incidents is the hot path for the
-- scanner (idempotency: if an incident is already open for a check_key, we
-- update it rather than open a new one).
CREATE INDEX night_watchman_incidents_open_idx
  ON public.night_watchman_incidents(check_key, opened_at DESC)
  WHERE closed_at IS NULL;
CREATE INDEX night_watchman_incidents_check_key_idx
  ON public.night_watchman_incidents(check_key, opened_at DESC);

ALTER TABLE public.night_watchman_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY night_watchman_incidents_admin_all
  ON public.night_watchman_incidents FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON TABLE public.night_watchman_incidents IS
  'Lifecycle of detected problems. Opens when a check fails, closes on auto-repair / sandbox PR merge / human resolution. telegram_message_ids ties back to outbound_notifications message_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. harness_config — killswitch + loop guards
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.harness_config (key, value, is_secret, description) VALUES
  ('SELF_REPAIR_HALTED', 'false', false,
   'Night-watchman global killswitch. true = no auto-repairs run. Settable via /api/self-repair/halt POST or admin SQL.'),
  ('NW_REPAIR_PER_CHECK_24H_CAP', '3', false,
   'Per-check rolling-24h auto-repair cap. Beyond this, escalate to human (loop guard).'),
  ('NW_REPAIR_GLOBAL_24H_CAP', '30', false,
   'Global rolling-24h auto-repair cap. Beyond this, halt + alert (loop guard).'),
  ('NW_REPAIR_PER_SCAN_CAP', '10', false,
   'Per-scan auto-repair cap. Beyond this, halt rest of scan (loop guard).')
ON CONFLICT (key) DO NOTHING;
