-- 0180_awaiting_approval_status.sql
-- Extends task_queue status CHECK constraint to include 'awaiting_approval'.
--
-- Used by F-N28-fix-A: coordinator exits after sending a requires_response
-- notification and sets task status to 'awaiting_approval'. The
-- coordinator-resume route transitions it back to 'queued' (priority 1)
-- when Colin's response arrives via the Telegram webhook.
--
-- No rows in the current DB use this status — no backfill needed.
--
-- GRANT: no new table; no GRANT block needed. -- AD7-exempt (status constraint only)

ALTER TABLE public.task_queue
  DROP CONSTRAINT IF EXISTS task_queue_status_check,
  ADD  CONSTRAINT task_queue_status_check
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
      'awaiting_grounding',
      'awaiting_approval'
    ));
