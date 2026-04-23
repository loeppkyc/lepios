import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { claimTask, peekTask, reclaimStale, failTask } from '@/lib/harness/task-pickup'
import { postMessage } from '@/lib/orchestrator/telegram'
import { sendMessageWithButtons } from '@/lib/harness/telegram-buttons'
import { fireCoordinator } from '@/lib/harness/invoke-coordinator'
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

export function buildRemoteTelegramMessage(task: TaskRow, sessionUrl: string): string {
  const shortId = task.id.slice(0, 8)
  const preview = task.task.length > 80 ? task.task.slice(0, 80) + '...' : task.task
  return [
    `✅ Task claimed: ${shortId}`,
    preview,
    '',
    `Coordinator invoked automatically.`,
    `Session: ${sessionUrl}`,
  ].join('\n')
}

// Returns the pre-generated event UUID so the caller can embed it in the Telegram button
// callback_data before sending. Returns null if the insert fails (swallowed).
async function logEvent(
  runId: string,
  status: 'success' | 'warning' | 'error',
  taskId: string | null,
  detail: string,
  durationMs: number,
  taskType = 'task_pickup',
  extraMeta: Record<string, unknown> = {}
): Promise<string | null> {
  const id = crypto.randomUUID()
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      id,
      domain: 'orchestrator',
      action: 'task_pickup',
      actor: 'task_pickup_cron',
      status,
      task_type: taskType,
      duration_ms: durationMs,
      output_summary: detail,
      meta: { run_id: runId, claimed_task_id: taskId, ...extraMeta },
      tags: ['task_pickup', 'harness', 'step5'],
    })
    return id
  } catch {
    return null
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

  // Step 4: agent_events row — inserted first so its UUID can go in the button callback_data
  const duration_ms = Date.now() - start
  const eventId = await logEvent(runId, 'success', task.id, `claimed: ${task.task}`, duration_ms)

  // Step 5: Remote invocation — fire coordinator automatically when flag is set.
  // On failure: fireCoordinator already logged to agent_events. Fall back to manual message.
  // No retries — duplicate /fire calls create duplicate sessions.
  let telegramMsg = buildTelegramMessage(task)
  if (process.env.HARNESS_REMOTE_INVOCATION_ENABLED) {
    const invokeResult = await fireCoordinator({ task_id: task.id, run_id: runId })
    if (invokeResult.ok) {
      telegramMsg = buildRemoteTelegramMessage(task, invokeResult.session_url)
    }
  }

  // Step 6: Telegram notification — awaited so Vercel doesn't kill the fetch mid-flight
  try {
    await sendMessageWithButtons(eventId ?? crypto.randomUUID(), telegramMsg)
  } catch (err) {
    await logEvent(
      runId,
      'error',
      task.id,
      `Telegram send failed for task ${task.id}`,
      Date.now() - start,
      'task_pickup_telegram_fail',
      { error: String(err) }
    )
    // Don't throw — task is already claimed, don't fail the whole pickup
  }

  return {
    ok: true,
    claimed: task,
    run_id: runId,
    duration_ms,
    ...(cancelledIds.length ? { cancelled_tasks: cancelledIds } : {}),
  }
}
