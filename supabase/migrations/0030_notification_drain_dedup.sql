-- 0030_notification_drain_dedup.sql
-- Replace the non-unique correlation_id index with a UNIQUE partial index.
-- Prevents duplicate Telegram notifications from parallel coordinator runs.

DROP INDEX IF EXISTS public.outbound_notifications_correlation_idx;

CREATE UNIQUE INDEX outbound_notifications_correlation_uniq
  ON public.outbound_notifications (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Rollback:
--   DROP INDEX IF EXISTS public.outbound_notifications_correlation_uniq;
--   CREATE INDEX outbound_notifications_correlation_idx
--     ON public.outbound_notifications (correlation_id)
--     WHERE correlation_id IS NOT NULL;
