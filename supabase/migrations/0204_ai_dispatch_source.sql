-- Add 'ai_dispatch' to task_queue.source CHECK constraint.
-- Enables POST /api/ai/dispatch to queue coordinator-tier tasks.
-- GRANT: no new table; no GRANT block needed. -- AD7-exempt (source constraint only)

ALTER TABLE public.task_queue
  DROP CONSTRAINT IF EXISTS task_queue_source_check,
  ADD  CONSTRAINT task_queue_source_check
    CHECK (source IN (
      'manual',
      'handoff-file',
      'colin-telegram',
      'cron',
      'improvement_engine',
      'api',
      'ai_dispatch'
    ));
