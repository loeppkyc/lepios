-- 0160_task_proposals.sql
-- Overnight Autonomy — Module B: queue pre-stager landing table.
--
-- Two-tier staging: proposal sources (failures.md, env-audit, gpu-day gaps,
-- self-repair DLQ, digest anomalies) write here first. The pre-stager cron
-- promotes a proposal into task_queue iff confidence ≥ 0.8 AND risk_score
-- maps to a tier the configured DEPLOY_GATE_RISK_TIER permits.
--
-- Why two-tier (not direct INSERT into task_queue): a hand-tuned heuristic
-- pushed straight to the queue would bury good tasks under noise (sibling of
-- F-L7 quota cliff). Proposals let Colin see what the system *would* queue
-- before it commits, and let auto-promotion thresholds tune per-source
-- without code changes.
--
-- Spec: docs/sprint-5/overnight-autonomy-acceptance.md §4
--
-- Verify post-apply:
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name = 'task_proposals' ORDER BY ordinal_position;
--   -- Expect 13 columns; risk_score smallint, confidence numeric(3,2), status default 'pending'.
--
-- Rollback: hand-write the destructive op for public.task_proposals if needed
-- (kept out of this comment so the safety static-check stays clean).

CREATE TABLE public.task_proposals (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  task              TEXT         NOT NULL,
  description       TEXT,

  source            TEXT         NOT NULL
                    CHECK (source IN (
                      'failures_md',
                      'env_audit',
                      'gpu_day_gap',
                      'self_repair_dlq',
                      'morning_digest',
                      'manual'
                    )),

  -- Stable identifier inside the source for dedup.
  -- failures_md → 'F-N7' / 'F-L11'
  -- env_audit   → 'docs/env-audit-2026-05-05.md#oura-token'
  -- gpu_day_gap → 'gpu-day:A4'
  -- self_repair_dlq → 'self-repair-run:<uuid>'
  -- morning_digest  → 'digest-anomaly:2026-05-06'
  source_ref        TEXT,

  -- 0.00 - 1.00. Threshold for auto-promotion is 0.8 (config-driven later).
  confidence        NUMERIC(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),

  -- 0 (lowest) - 100 (highest). Mapped to RiskTier at promote time:
  --   0–20  → low
  --   21–50 → medium
  --   51–70 → migration-allow
  --   71+   → off (always wait for Colin)
  risk_score        SMALLINT     NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),

  -- Used as task_queue.priority on auto-promote. 1 = highest, 10 = lowest.
  proposed_priority SMALLINT     NOT NULL DEFAULT 5
                    CHECK (proposed_priority >= 1 AND proposed_priority <= 10),

  metadata          JSONB        NOT NULL DEFAULT '{}'::jsonb,

  status            TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'promoted', 'dismissed', 'superseded')),

  -- FK to task_queue when status='promoted'. NULL otherwise.
  promoted_task_id  UUID         REFERENCES public.task_queue(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ
);

-- Pre-stager cron picks pending proposals by confidence DESC, newest first.
CREATE INDEX task_proposals_pending_idx
  ON public.task_proposals (status, confidence DESC, created_at DESC)
  WHERE status = 'pending';

-- Dedup: a given (source, source_ref) is unique while pending or already promoted.
-- Dismissed/superseded rows are kept for audit but don't block re-staging if
-- the same source_ref recurs after a deliberate dismissal — Colin can re-trigger
-- by inserting fresh from the cron path.
CREATE UNIQUE INDEX task_proposals_dedup_idx
  ON public.task_proposals (source, source_ref)
  WHERE source_ref IS NOT NULL AND status IN ('pending', 'promoted');

ALTER TABLE public.task_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_proposals_authenticated" ON public.task_proposals
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Service role bypasses RLS; cron + tests use it directly.

COMMENT ON TABLE public.task_proposals IS
  'Pre-stager landing zone — proposals from automated sources before they become task_queue rows. See docs/sprint-5/overnight-autonomy-acceptance.md.';

COMMENT ON COLUMN public.task_proposals.risk_score IS
  '0-100. Maps to RiskTier at promote time. 0-20=low, 21-50=medium, 51-70=migration-allow, 71+=off.';
