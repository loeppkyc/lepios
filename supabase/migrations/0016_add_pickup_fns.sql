-- 0016_add_pickup_fns.sql
-- Postgres functions for atomic task pickup (harness component #5).
-- Both functions use FOR UPDATE SKIP LOCKED to prevent race conditions
-- when concurrent pickup runs execute simultaneously.

-- ── claim_next_task ───────────────────────────────────────────────────────────
-- Atomically claim the highest-priority queued task for a given pickup run.
-- Returns 0 rows if the queue is empty or all queued rows are locked by a
-- concurrent run (second caller gets nothing — safe no-op).

CREATE OR REPLACE FUNCTION public.claim_next_task(p_run_id TEXT)
RETURNS SETOF public.task_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.task_queue
  SET
    status     = 'claimed',
    claimed_at = NOW(),
    claimed_by = p_run_id
  WHERE id = (
    SELECT id
    FROM   public.task_queue
    WHERE  status = 'queued'
    ORDER  BY priority ASC, created_at ASC
    LIMIT  1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- ── reclaim_stale_tasks ───────────────────────────────────────────────────────
-- Reset stale claimed/running tasks back to queued (or cancel if exhausted).
-- Stale = COALESCE(last_heartbeat_at, claimed_at) < NOW() - INTERVAL '10 minutes'.
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
      AND  COALESCE(q.last_heartbeat_at, q.claimed_at) < NOW() - INTERVAL '10 minutes'
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
--   DROP FUNCTION IF EXISTS public.claim_next_task(TEXT);
--   DROP FUNCTION IF EXISTS public.reclaim_stale_tasks();
