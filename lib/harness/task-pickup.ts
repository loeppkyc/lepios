import { createServiceClient } from '@/lib/supabase/service'

export type TaskRow = {
  id: string
  task: string
  description: string | null
  priority: number
  status: string
  source: string
  metadata: Record<string, unknown>
  result: Record<string, unknown> | null
  retry_count: number
  max_retries: number
  created_at: string
  claimed_at: string | null
  claimed_by: string | null
  last_heartbeat_at: string | null
  completed_at: string | null
  error_message: string | null
}

export type ReclaimRow = {
  action: string // 'queued' | 'cancelled'
  task_id: string
  new_retry_count: number
}

// Atomically claim the highest-priority queued task via FOR UPDATE SKIP LOCKED.
// Returns null when the queue is empty or a concurrent run won the race.
export async function claimTask(runId: string): Promise<TaskRow | null> {
  const db = createServiceClient()
  const { data, error } = await db.rpc('claim_next_task', { p_run_id: runId }).maybeSingle()
  if (error) throw error
  return (data as TaskRow | null) ?? null
}

// Peek at the highest-priority queued task without claiming it (dry-run use).
export async function peekTask(): Promise<TaskRow | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('task_queue')
    .select('*')
    .eq('status', 'queued')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as TaskRow | null) ?? null
}

// Update last_heartbeat_at — called by coordinator every 5 min while running.
export async function heartbeat(taskId: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('task_queue')
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw error
}

// Reset stale claimed/running tasks via FOR UPDATE SKIP LOCKED in Postgres.
// Returns one row per affected task with the action taken and new retry count.
export async function reclaimStale(): Promise<ReclaimRow[]> {
  const db = createServiceClient()
  const { data, error } = await db.rpc('reclaim_stale_tasks')
  if (error) throw error
  return (data as ReclaimRow[]) ?? []
}

// Mark a task completed with an optional structured result payload.
export async function completeTask(
  taskId: string,
  result?: Record<string, unknown>
): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('task_queue')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      ...(result !== undefined ? { result } : {}),
    })
    .eq('id', taskId)
  if (error) throw error
}

// Mark a task failed with an error message.
export async function failTask(taskId: string, errorMessage: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('task_queue')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId)
  if (error) throw error
}
