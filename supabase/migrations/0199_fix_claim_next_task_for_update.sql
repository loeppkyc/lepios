-- Migration 0199: fix claim_next_task — FOR UPDATE on LEFT JOIN is illegal
--
-- Migration 0176 rewrote claim_next_task with a LEFT JOIN on streamlit_modules
-- so module-locked tasks are skipped. PostgreSQL 17 disallows FOR UPDATE SKIP LOCKED
-- on the nullable side of an outer join (ERROR 0A000).
--
-- Fix: replace LEFT JOIN with NOT EXISTS, which is semantically identical and
-- does not restrict FOR UPDATE (only task_queue rows are locked).
--
-- Semantics preserved:
--   - Task with no matching harness_module_id row → eligible (non-port task)
--   - Task with matching row where manual_owner and in_progress_branch are both NULL → eligible
--   - Task with matching row where either lock column is set → excluded this tick

CREATE OR REPLACE FUNCTION public.claim_next_task(p_run_id text)
 RETURNS SETOF task_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.task_queue
  SET
    status     = 'claimed',
    claimed_at = pg_catalog.now(),
    claimed_by = p_run_id
  WHERE id = (
    SELECT tq.id
    FROM   public.task_queue tq
    WHERE  tq.status = 'queued'
      AND NOT EXISTS (
        SELECT 1
        FROM   public.streamlit_modules sm
        WHERE  sm.harness_module_id = (tq.metadata->>'module_id')
          AND  (sm.manual_owner IS NOT NULL OR sm.in_progress_branch IS NOT NULL)
      )
    ORDER  BY tq.priority ASC, tq.created_at ASC
    LIMIT  1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_next_task(text) TO service_role;
