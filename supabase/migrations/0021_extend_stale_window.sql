-- 0021_extend_stale_window.sql
-- Extends the stale-reclaim window from 10 minutes to 15 minutes.
-- Coordinators send heartbeats every ~3 minutes (5× safety margin).
-- Only change from 0016_add_pickup_fns.sql: INTERVAL '10 minutes' → INTERVAL '15 minutes'.

-- ── reclaim_stale_tasks ───────────────────────────────────────────────────────
-- Reset stale claimed/running tasks back to queued (or cancel if exhausted).
-- Stale = COALESCE(last_heartbeat_at, claimed_at) < NOW() - INTERVAL '15 minutes'.
--
-- Per task:
--   retry_count += 1
--   if new retry_count >= max_retries → 'cancelled' + error_message
--   else                              → 'queued', clear claim fields
--
-- FOR UPDATE SKIP LOCKED prevents two concurrent pickup runs from
-- double-incrementing retry_count on the same stale task.
--
-- Returns one row per affected task: action ('queued'|'cancelled'),
-- task_id, new_retry_count.

CREATE OR REPLACE FUNCTION public.reclaim_stale_tasks()
RETURNS TABLE(action TEXT, task_id UUID, new_retry_count SMALLINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec           RECORD;
  v_new_rc      SMALLINT;
  v_new_status  TEXT;
BEGIN
  FOR rec IN
    SELECT q.id, q.retry_count, q.max_retries
    FROM   public.task_queue q
    WHERE  q.status IN ('claimed', 'running')
      AND  COALESCE(q.last_heartbeat_at, q.claimed_at) < NOW() - INTERVAL '15 minutes'
    FOR UPDATE SKIP LOCKED
  LOOP
    v_new_rc := (rec.retry_count + 1)::SMALLINT;

    IF v_new_rc >= rec.max_retries THEN
      v_new_status := 'cancelled';
      UPDATE public.task_queue
      SET
        retry_count   = v_new_rc,
        status        = 'cancelled',
        error_message = 'stale claim: max retries exhausted',
        completed_at  = NOW()
      WHERE id = rec.id;
    ELSE
      v_new_status := 'queued';
      UPDATE public.task_queue
      SET
        retry_count       = v_new_rc,
        status            = 'queued',
        claimed_at        = NULL,
        claimed_by        = NULL,
        last_heartbeat_at = NULL
      WHERE id = rec.id;
    END IF;

    action          := v_new_status;
    task_id         := rec.id;
    new_retry_count := v_new_rc;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Rollback:
--   See 0016_add_pickup_fns.sql — revert INTERVAL to '10 minutes'.
--   DROP FUNCTION is not required; CREATE OR REPLACE updates in place.
