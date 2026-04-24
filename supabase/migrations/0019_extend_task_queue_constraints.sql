-- 0019_extend_task_queue_constraints.sql
-- Extends task_queue CHECK constraints to include improvement engine values.
--
-- Blockers documented in migration 0018 §SCHEMA CONSTRAINT NOTE:
--   source = 'improvement_engine'  — improvement engine inserts use this source
--   status = 'auto_proceeded'      — auto-proceed gate sets this status
--   status = 'approved'            — Colin approve_all sets this status
--   status = 'dismissed'           — Colin dismiss sets this status
--
-- Explicit Colin approval obtained 2026-04-24 per ARCHITECTURE.md §3 rule 3.

ALTER TABLE public.task_queue
  DROP CONSTRAINT IF EXISTS task_queue_source_check,
  ADD  CONSTRAINT task_queue_source_check
    CHECK (source IN (
      'manual',
      'handoff-file',
      'colin-telegram',
      'cron',
      'improvement_engine'
    ));

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
      'dismissed'
    ));
