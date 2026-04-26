-- 0031_awaiting_grounding_constraint.sql
-- Adds grounding_question column to task_queue and enforces that tasks cannot
-- be placed in status='awaiting_grounding' without a grounding_question set.
-- Prevents the coordinator from leaving a task stuck with nothing for Colin
-- to answer.
--
-- Three changes, in dependency order:
--   1. Add grounding_question column (nullable — only set for awaiting_grounding tasks)
--   2. Extend task_queue_status_check to include 'awaiting_grounding'
--   3. Add cross-column CHECK: awaiting_grounding requires grounding_question IS NOT NULL
--
-- Audit pre-check: awaiting_grounding was not a valid status before this migration,
-- so no existing rows need remediation.
--
-- Rollback:
--   ALTER TABLE public.task_queue DROP CONSTRAINT IF EXISTS task_queue_awaiting_grounding_requires_question;
--   ALTER TABLE public.task_queue DROP CONSTRAINT IF EXISTS task_queue_status_check;
--   ALTER TABLE public.task_queue ADD CONSTRAINT task_queue_status_check
--     CHECK (status IN ('queued','claimed','running','completed','failed','cancelled',
--                       'auto_proceeded','approved','dismissed','awaiting_review','review_timeout'));
--   ALTER TABLE public.task_queue DROP COLUMN IF EXISTS grounding_question;

-- 1. Add column
ALTER TABLE public.task_queue
  ADD COLUMN IF NOT EXISTS grounding_question TEXT;

-- 2. Extend status constraint
ALTER TABLE public.task_queue
  DROP CONSTRAINT IF EXISTS task_queue_status_check,
  ADD CONSTRAINT task_queue_status_check
    CHECK (status IN (
      'queued',
      'claimed',
      'running',
      'completed',
      'failed',
      'cancelled',
      'auto_proceeded',
      'approved',
      'dismissed',
      'awaiting_review',
      'review_timeout',
      'awaiting_grounding'
    ));

-- 3. Require grounding_question when status = awaiting_grounding
ALTER TABLE public.task_queue
  ADD CONSTRAINT task_queue_awaiting_grounding_requires_question
    CHECK (
      status != 'awaiting_grounding'
      OR grounding_question IS NOT NULL
    );
