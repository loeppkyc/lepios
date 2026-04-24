CREATE TABLE entity_attribution (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type           TEXT NOT NULL,          -- 'task_queue', 'improvement_proposal', etc.
  entity_id             UUID NOT NULL,           -- FK to the entity's primary key
  action                TEXT NOT NULL,           -- 'created', 'claimed', 'completed', 'approved', 'dismissed', 'auto_proceeded'
  actor_type            TEXT NOT NULL,           -- 'improvement_engine' | 'coordinator' | 'task_pickup_cron' | 'human' | 'cron'
  actor_id              TEXT,                    -- specific identifier (e.g., coordinator session name)
  run_id                UUID,                    -- task-pickup cron run UUID (from task_queue.claimed_by)
  coordinator_session_id TEXT,                   -- Anthropic Routines session ID
  source_task_id        UUID,                    -- task_queue.id that triggered this write (if any)
  commit_sha            TEXT,                    -- from deploy-gate; nullable
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  details               JSONB                    -- what changed: fingerprint, concrete_action, etc.
);

-- Query patterns: changelog for one entity, all actions by one actor
CREATE INDEX idx_entity_attribution_entity
  ON entity_attribution (entity_type, entity_id, occurred_at DESC);

CREATE INDEX idx_entity_attribution_actor
  ON entity_attribution (actor_type, occurred_at DESC);

CREATE INDEX idx_entity_attribution_run
  ON entity_attribution (run_id) WHERE run_id IS NOT NULL;

CREATE INDEX idx_entity_attribution_session
  ON entity_attribution (coordinator_session_id) WHERE coordinator_session_id IS NOT NULL;

COMMENT ON TABLE entity_attribution IS
  'Provenance log: which agent/run/session/commit created or modified each entity.';
