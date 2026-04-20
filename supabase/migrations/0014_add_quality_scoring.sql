-- Adds quality scoring infrastructure per docs/feedback-loop-scoring.md.
-- Two new columns on agent_events (task_type, quality_score) and a new
-- task_feedback table for human thumbs + retrospective signal corrections.
-- Both columns are nullable — backfill happens in a separate step (§9 step 3).
-- task_type will be made NOT NULL after backfill confirms full coverage.

BEGIN;

-- Add task_type to agent_events (nullable for now, required after backfill)
ALTER TABLE public.agent_events
    ADD COLUMN task_type     TEXT,
    ADD COLUMN quality_score JSONB;

-- Index task_type for per-task-type trend queries and dashboard filtering
CREATE INDEX ON public.agent_events (task_type);

-- Human feedback table: thumbs + retrospective signal-quality corrections
CREATE TABLE public.task_feedback (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_event_id   UUID        NOT NULL REFERENCES public.agent_events(id) ON DELETE CASCADE,
    feedback_type    TEXT        CHECK (feedback_type IN ('thumbs_up', 'thumbs_down', 'signal_validation')),
    value            TEXT,
    source           TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    meta             JSONB
);

-- Index for join performance when looking up feedback by event
CREATE INDEX ON public.task_feedback (agent_event_id);

COMMIT;
