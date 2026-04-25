-- 0026_task_queue_review_statuses.sql
-- Extends task_queue status CHECK constraint to include two new values required
-- by the purpose_review gate (Sprint 5).
--
-- New statuses added:
--   awaiting_review  — task is blocked waiting for Colin's Telegram reply
--   review_timeout   — 72h elapsed with no Colin reply; harness fires alert
--
-- Explicit Colin approval obtained 2026-04-25 per ARCHITECTURE.md §3 rule 3.

-- ── Backfill safety check ─────────────────────────────────────────────────────
-- Abort the migration if any existing rows have a status value that is NOT in
-- the new expanded set. This prevents silently stranding data that would violate
-- the updated constraint after the ALTER.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM task_queue
    WHERE status NOT IN (
      'queued','claimed','running','completed','failed','cancelled',
      'auto_proceeded','approved','dismissed',
      'awaiting_review','review_timeout'
    )
  ) THEN
    RAISE EXCEPTION 'task_queue contains rows with unknown status values — migration aborted';
  END IF;
END $$;

-- ── Extend constraint ─────────────────────────────────────────────────────────

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
      'review_timeout'
    ));
