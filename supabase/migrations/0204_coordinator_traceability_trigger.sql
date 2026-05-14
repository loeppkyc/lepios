-- 0204_coordinator_traceability_trigger.sql
-- Coordinator traceability (Option B — DB trigger) + budget increment fix.
--
-- 1. Trigger on task_queue: when status transitions to 'completed', stamp
--    metadata.commit_sha from harness_config.LAST_BUILDER_COMMIT_SHA if not
--    already present. Coordinator writes LAST_BUILDER_COMMIT_SHA to
--    harness_config after each builder handoff.
--
-- 2. Same trigger: increment the active work_budget_sessions row —
--    used_minutes += actual_minutes, completed_count += 1. Fixes
--    used_minutes_completed_count_not_incremented (dbbb1a53 also_covers).
--
-- 3. Add 'expired' to work_budget_sessions.status constraint. Fixes
--    work_budget_sessions_status_constraint_missing_expired (dbbb1a53 also_covers).
--
-- No new tables — no service_role GRANTs needed (F24 not triggered).

-- ── 1. work_budget_sessions status constraint: add 'expired' ──────────────────

ALTER TABLE public.work_budget_sessions
  DROP CONSTRAINT work_budget_sessions_status_check;

ALTER TABLE public.work_budget_sessions
  ADD CONSTRAINT work_budget_sessions_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'drained'::text, 'stopped'::text, 'expired'::text]));

-- ── 2. Trigger function ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.on_task_queue_completed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_commit_sha TEXT;
BEGIN
  -- Only fire on status transition TO 'completed'.
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  -- ── a. Stamp commit_sha if missing ────────────────────────────────────────
  IF NEW.metadata->>'commit_sha' IS NULL THEN
    SELECT value INTO v_commit_sha
      FROM public.harness_config
      WHERE key = 'LAST_BUILDER_COMMIT_SHA'
      LIMIT 1;

    IF v_commit_sha IS NOT NULL AND v_commit_sha <> '' THEN
      NEW.metadata := NEW.metadata || jsonb_build_object('commit_sha', v_commit_sha);
    END IF;
  END IF;

  -- ── b. Budget increment ───────────────────────────────────────────────────
  -- actual_minutes may be NULL (e.g. test rows). Only increment if set.
  IF NEW.actual_minutes IS NOT NULL THEN
    UPDATE public.work_budget_sessions
    SET
      used_minutes    = used_minutes    + NEW.actual_minutes,
      completed_count = completed_count + 1
    WHERE status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Attach trigger ─────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS task_queue_on_completed ON public.task_queue;

CREATE TRIGGER task_queue_on_completed
  BEFORE UPDATE ON public.task_queue
  FOR EACH ROW EXECUTE FUNCTION public.on_task_queue_completed();

-- ── Rollback ──────────────────────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS task_queue_on_completed ON public.task_queue;
--   DROP FUNCTION IF EXISTS public.on_task_queue_completed();
--   ALTER TABLE public.work_budget_sessions
--     DROP CONSTRAINT work_budget_sessions_status_check;
--   ALTER TABLE public.work_budget_sessions
--     ADD CONSTRAINT work_budget_sessions_status_check
--     CHECK (status = ANY (ARRAY['active'::text, 'drained'::text, 'stopped'::text]));
