-- 0015_add_task_queue.sql
-- Harness component #5: task pickup queue.
-- A Supabase-backed queue where work items accumulate and are claimed
-- atomically by the daily pickup cron (GET /api/cron/task-pickup).
-- Full design: docs/harness-component-5-task-pickup.md
--
-- Status transitions:
--   queued  → claimed  → running → (completed | failed)
--   any     → cancelled
--   failed  → queued   (if retry_count < max_retries)

CREATE TABLE public.task_queue (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Instruction payload sent to coordinator
  task        TEXT      NOT NULL,
  description TEXT,                                       -- optional long-form context

  -- 1 = highest priority, 10 = lowest; ties broken by created_at ASC
  priority    SMALLINT  NOT NULL DEFAULT 5,

  -- Lifecycle state.
  -- queued    → waiting to be claimed by pickup cron
  -- claimed   → pickup cron claimed it; handoff written; coordinator not yet started
  -- running   → coordinator actively executing with heartbeat (distinguishes from claimed-but-not-started)
  -- completed → coordinator finished successfully
  -- failed    → unrecoverable error or exhausted retries
  -- cancelled → manually cancelled, or max_retries hit on stale reclaim
  status      TEXT      NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued','claimed','running','completed','failed','cancelled')),

  -- Provenance of the task
  source      TEXT      NOT NULL DEFAULT 'manual'
              CHECK (source IN ('manual','handoff-file','colin-telegram','cron')),

  -- Flexible per-task context (sprint_id, chunk_id, source_ref, etc.)
  metadata    JSONB     NOT NULL DEFAULT '{}'::jsonb,

  -- Structured output from coordinator on completion
  result      JSONB,

  -- Retry tracking
  retry_count SMALLINT  NOT NULL DEFAULT 0,
  max_retries SMALLINT  NOT NULL DEFAULT 2,               -- matches global retry limit in CLAUDE.md

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at        TIMESTAMPTZ,
  claimed_by        TEXT,                                 -- pickup run_id; prevents double-claim
  last_heartbeat_at TIMESTAMPTZ,                         -- updated every 5 min while coordinator runs
  completed_at      TIMESTAMPTZ,
  error_message     TEXT                                  -- populated on failed or cancelled
);

COMMENT ON TABLE  public.task_queue IS
  'Harness component #5 task queue. Pickup cron claims tasks atomically; '
  'coordinator executes them. See docs/harness-component-5-task-pickup.md.';

COMMENT ON COLUMN public.task_queue.priority IS
  '1 = highest priority, 10 = lowest. Ties broken by created_at ASC.';

COMMENT ON COLUMN public.task_queue.last_heartbeat_at IS
  'Updated every 5 min while coordinator is running. '
  'Stale condition: COALESCE(last_heartbeat_at, claimed_at) < NOW() - INTERVAL ''10 minutes''.';

COMMENT ON COLUMN public.task_queue.claimed_by IS
  'UUID of the pickup run that claimed this task. Prevents double-claim under concurrent cron invocations.';

-- Pickup query: highest-priority queued task first
CREATE INDEX task_queue_pickup_idx
  ON public.task_queue (status, priority ASC, created_at ASC);

-- Stale-claim reclaim: find claimed/running tasks with stale heartbeat
CREATE INDEX task_queue_stale_idx
  ON public.task_queue (status, last_heartbeat_at)
  WHERE status IN ('claimed', 'running');

-- Observability: tasks by source, newest first
CREATE INDEX task_queue_source_idx
  ON public.task_queue (source, created_at DESC);

-- RLS: service role bypasses automatically (no explicit policy needed for service client).
-- Authenticated users get full access — single-user app for v0.
-- SPRINT5-GATE: tighten to profiles.id when multi-user ships.
ALTER TABLE public.task_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_queue_authenticated" ON public.task_queue
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Rollback:
--   DROP TABLE IF EXISTS public.task_queue;
