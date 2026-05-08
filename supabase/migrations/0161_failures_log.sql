-- 0161_failures_log.sql
-- T-006 Phase 1a — Failures Log table.
--
-- Source of truth for the failures-learning loop. Self-repair + Safety Agent
-- both write to it. Safety Agent reads it on every PR to pattern-match
-- incoming changes against known signatures.
--
-- Phase 1b: nightly cron renders this table → docs/claude-md/failures.md.
-- Phase 1c: /failures cockpit page reads + manual entry form writes.
--
-- Spec: docs/leverage-targets.md#t-006--failures-log-revised-2026-05-08
--
-- Verify post-apply:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'failures_log' ORDER BY ordinal_position;
--
-- Rollback: hand-write the destructive op for public.failures_log if needed
-- (kept out of this comment so the safety static-check stays clean).

CREATE TABLE public.failures_log (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity. failure_number assigned at insert time by app code (F-N16, F-N17, ...).
  -- Nullable until assigned; unique partial index below.
  failure_number  TEXT,
  title           TEXT         NOT NULL CHECK (length(trim(title)) > 0),

  -- Trigger context. Distinguishes how the row was created.
  trigger_context TEXT         NOT NULL DEFAULT 'manual'
                  CHECK (trigger_context IN (
                    'manual',         -- Colin entered via /failures form
                    'self_repair',    -- self-repair detector wrote it
                    'safety_agent',   -- Safety Agent BLOCK / twin ESCALATE
                    'pr',             -- PR-time check that surfaced a failure
                    'workflow'        -- CI/cron failure
                  )),
  trigger_ref     TEXT,                 -- PR number / workflow run id / NULL

  -- Body. what_happened is required; the rest fill as analysis progresses.
  what_happened     TEXT NOT NULL CHECK (length(trim(what_happened)) > 0),
  expected_behavior TEXT,
  actual_behavior   TEXT,
  root_cause        TEXT,
  fix_commit_sha    TEXT,
  lesson            TEXT,                -- terse "what to do differently"

  -- Pattern signature. JSONB shape (initial design — tunable later):
  --   { type, file_glob?, error_class?, touched_files?, keywords? }
  -- Indexed via GIN for cross-PR matching (Safety Agent read path).
  pattern_signature JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Severity + lifecycle.
  severity TEXT NOT NULL DEFAULT 'medium'
           CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status   TEXT NOT NULL DEFAULT 'open'
           CHECK (status IN ('open', 'fixing', 'fixed', 'recurring')),

  -- Recurrence tracking. occurrence_count >= 1 always (1 = first sighting).
  occurrence_count INT          NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  first_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- /failures dashboard primary sort: open + recurring first, then by severity, then recency.
CREATE INDEX failures_log_dashboard_idx
  ON public.failures_log (status, severity DESC, last_seen_at DESC);

-- Pattern-match read path (Safety Agent): GIN on jsonb for @> containment queries.
CREATE INDEX failures_log_signature_idx
  ON public.failures_log USING GIN (pattern_signature jsonb_path_ops);

-- F-N{n} unique while assigned. NULL allowed during pre-assignment window.
CREATE UNIQUE INDEX failures_log_failure_number_uniq_idx
  ON public.failures_log (failure_number)
  WHERE failure_number IS NOT NULL;

-- Status filter index (recurring/open lookups in dashboard + cron grouping).
CREATE INDEX failures_log_status_idx
  ON public.failures_log (status, last_seen_at DESC);

ALTER TABLE public.failures_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "failures_log_authenticated" ON public.failures_log
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- updated_at maintained by app code (no trigger; matches existing convention
-- in tables that don't lean on triggers for audit columns).

COMMENT ON TABLE public.failures_log IS
  'Source of truth for the failures-learning loop. Self-repair + Safety Agent write; Safety Agent reads for pattern matching. Nightly cron syncs to docs/claude-md/failures.md. See docs/leverage-targets.md#t-006.';

COMMENT ON COLUMN public.failures_log.pattern_signature IS
  'JSONB fingerprint for cross-PR matching. Initial shape: {type, file_glob?, error_class?, touched_files?, keywords?}. GIN-indexed.';

COMMENT ON COLUMN public.failures_log.lesson IS
  'Terse "what to do differently". Rendered into docs/claude-md/failures.md so future Claude sessions see prescription, not just description.';
