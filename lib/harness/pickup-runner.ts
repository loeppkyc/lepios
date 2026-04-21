import { createServiceClient } from '@/lib/supabase/service'
import { claimTask, peekTask, reclaimStale, failTask } from '@/lib/harness/task-pickup'
import { postMessage } from '@/lib/orchestrator/telegram'
import type { TaskRow, ReclaimRow } from '@/lib/harness/task-pickup'

export type PickupResult = {
  ok: boolean
  run_id: string
  claimed: TaskRow | null
  reason?: string
  dry_run?: boolean
  duration_ms: number
  cancelled_tasks?: string[]
}

export function buildTelegramMessage(task: TaskRow, dryRun = false): string {
  const shortId = task.id.slice(0, 8)
  const preview = task.task.length > 80 ? task.task.slice(0, 80) + '...' : task.task
  const prefix = dryRun ? '[DRY RUN] ' : ''
  return [
    `${prefix}✅ Task claimed: ${shortId}`,
    preview,
    '',
    `To run: paste \`Run task ${task.id}\` into Claude Code`,
  ].join('\n')
}

async function logEvent(
  runId: string,
  status: 'success' | 'warning' | 'error',
  taskId: string | null,
  detail: string,
  durationMs: number
): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'task_pickup',
      actor: 'task_pickup_cron',
      status,
      task_type: 'task_pickup',
      duration_ms: durationMs,
      output_summary: detail,
      meta: { run_id: runId, claimed_task_id: taskId },
      tags: ['task_pickup', 'harness', 'step5'],
    })
  } catch {
    // Swallow — result is still returned to caller
  }
}

export async function runPickup(runId: string): Promise<PickupResult> {
  const start = Date.now()

  // Dry-run: peek without mutations, Telegram prefixed
  if (process.env.TASK_PICKUP_DRY_RUN) {
    const task = await peekTask()
    const duration_ms = Date.now() - start
    if (task) {
      void postMessage(buildTelegramMessage(task, true)).catch(() => {})
    }
    return { ok: true, claimed: task, run_id: runId, dry_run: true, duration_ms }
  }

  // Step 1: stale claim recovery — runs before every pickup attempt
  let staleRows: ReclaimRow[] = []
  try {
    staleRows = await reclaimStale()
  } catch {
    // Stale recovery failure is non-fatal; proceed to claim
  }

  const cancelledIds: string[] = []
  for (const row of staleRows) {
    if (row.action === 'cancelled') {
      cancelledIds.push(row.task_id)
      void postMessage(
        `[LepiOS Harness] Task cancelled — stale claim exhausted\n\nTask ID: ${row.task_id}\nRetries: ${row.new_retry_count}`
      ).catch(() => {})
    }
  }

  // Step 2: claim the top-priority queued task
  const task = await claimTask(runId)

  if (!task) {
    const duration_ms = Date.now() - start
    await logEvent(runId, 'success', null, 'queue-empty', duration_ms)
    return {
      ok: true,
      claimed: null,
      reason: 'queue-empty',
      run_id: runId,
      duration_ms,
      ...(cancelledIds.length ? { cancelled_tasks: cancelledIds } : {}),
    }
  }

  // Step 3: validate task payload
  if (!task.task?.trim()) {
    await failTask(task.id, 'validation: task field is empty')
    const duration_ms = Date.now() - start
    void postMessage(
      `[LepiOS Harness] Task validation failed\n\nTask ID: ${task.id}\nError: task field is empty`
    ).catch(() => {})
    await logEvent(runId, 'error', task.id, 'validation-failed: task field empty', duration_ms)
    return { ok: true, claimed: null, reason: 'validation-failed', run_id: runId, duration_ms }
  }

  // Step 4: Telegram notification — task_queue row IS the handoff; no file needed
  void postMessage(buildTelegramMessage(task)).catch(() => {})

  // Step 5: agent_events row
  const duration_ms = Date.now() - start
  await logEvent(runId, 'success', task.id, `claimed: ${task.task}`, duration_ms)

  return {
    ok: true,
    claimed: task,
    run_id: runId,
    duration_ms,
    ...(cancelledIds.length ? { cancelled_tasks: cancelledIds } : {}),
  }
}
