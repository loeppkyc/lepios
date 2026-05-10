-- Migration 0176: coordinator module-lock enforcement
--
-- Gap: claim_next_task() selects purely by priority + created_at with no awareness
-- of streamlit_modules lock state. When a human works on a module
-- (in_progress_branch or manual_owner set), the autonomous coordinator still picks
-- tasks for that module from the queue — conflict.
--
-- Root cause: no join key existed between task_queue.metadata->>'module_id'
-- (inventory slug, e.g. 'pageprofit-scanner') and streamlit_modules.path
-- (file path, e.g. 'pages/21_PageProfit.py'). This migration adds the bridge.
--
-- Changes:
--   1. harness_module_id TEXT column on streamlit_modules — the join key.
--   2. Unique partial index prevents duplicate slug assignments.
--   3. Seed: pages/21_PageProfit.py → 'pageprofit-scanner'.
--   4. claim_next_task() rewritten with LEFT JOIN — tasks whose matched
--      streamlit_modules row is locked are atomically excluded from pickup.
--      Tasks with no matching row (non-port tasks) pass through unchanged.
--
-- Rollback:
--   1. Restore previous claim_next_task() body (no LEFT JOIN, no lock filter).
--   2. Remove idx_streamlit_modules_harness_id index.
--   3. Remove harness_module_id column from streamlit_modules.

-- ── 1. Bridge column ──────────────────────────────────────────────────────────

ALTER TABLE public.streamlit_modules
  ADD COLUMN IF NOT EXISTS harness_module_id text;

-- ── 2. Unique partial index ────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_streamlit_modules_harness_id
  ON public.streamlit_modules (harness_module_id)
  WHERE harness_module_id IS NOT NULL;

-- ── 3. Seed known mapping ──────────────────────────────────────────────────────

UPDATE public.streamlit_modules
  SET harness_module_id = 'pageprofit-scanner'
  WHERE path = 'pages/21_PageProfit.py';

-- ── 4. Rewrite claim_next_task with module-lock awareness ─────────────────────
--
-- LEFT JOIN only fires when metadata->>'module_id' matches a known harness_module_id.
-- sm.id IS NULL → no matching port-catalog row → eligible (non-port task).
-- sm.id IS NOT NULL but both lock columns NULL → matched but unlocked → eligible.
-- sm.id IS NOT NULL and either lock column set → locked → excluded this tick.

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
    LEFT JOIN public.streamlit_modules sm
           ON sm.harness_module_id = (tq.metadata->>'module_id')
    WHERE  tq.status = 'queued'
      AND (
        sm.id IS NULL  -- no matching module row (non-port task) → eligible
        OR (sm.manual_owner IS NULL AND sm.in_progress_branch IS NULL)  -- unlocked → eligible
      )
    ORDER  BY tq.priority ASC, tq.created_at ASC
    LIMIT  1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$function$;
