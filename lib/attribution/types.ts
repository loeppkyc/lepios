// Zero runtime imports — safe to import from client or server components.
// ActorType enum and AttributionContext are the single contract between
// all write sites and the attribution writer.

export type ActorType = 'improvement_engine' | 'coordinator' | 'task_pickup_cron' | 'cron' | 'human'

export interface AttributionContext {
  actor_type: ActorType
  actor_id?: string // e.g., coordinator session name, cron route path
  run_id?: string // UUID from task-pickup cron invocation
  coordinator_session_id?: string
  source_task_id?: string // task_queue.id that triggered this work
  commit_sha?: string // optional; from deploy-gate
}
