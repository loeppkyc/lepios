import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { claimTask, peekTask, reclaimStale, failTask } from '@/lib/harness/task-pickup'
import { postMessage } from '@/lib/orchestrator/telegram'
import { sendMessageWithButtons } from '@/lib/harness/telegram-buttons'
import { fireCoordinator } from '@/lib/harness/invoke-coordinator'
import type { TaskRow, ReclaimRow } from '@/lib/harness/task-pickup'
import { recordAttribution } from '@/lib/attribution/writer'
import {
  getActiveSession,
  canClaimNextTask,
  incrementBudgetUsedMinutes,
  drainSession,
  sendDrainSummary,
  MIN_CLAIMABLE_MINUTES,
} from '@/lib/work-budget/tracker'
import { estimateTask } from '@/lib/work-budget/estimator'
import { runCalibration } from '@/lib/work-budget/calibrator'
import { logEvent as logKnowledgeEvent } from '@/lib/knowledge/client'

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

  // F18: Log stale reclaim event when any rows were affected
  if (staleRows.length > 0) {
    const reclaimedIds = staleRows.filter((r) => r.action === 'queued').map((r) => r.task_id)
    const cancelledStaleIds = staleRows
      .filter((r) => r.action === 'cancelled')
      .map((r) => r.task_id)
    void logEvent(
      runId,
      'warning',
      null,
      `stale reclaim: ${staleRows.length} task(s) affected`,
      Date.now() - start,
      'task_pickup_stale_reclaimed',
      {
        count: staleRows.length,
        reclaimed: reclaimedIds,
        cancelled: cancelledStaleIds,
      }
    )
  }

  // Budget-aware pre-claim check
  // Zero-change path when no active session exists.
  const budgetSession = await getActiveSession()
  if (budgetSession) {
    // Estimate cost of the next task before claiming
    let estimatedMinutes = MIN_CLAIMABLE_MINUTES
    try {
      const db = createServiceClient()
      // Peek at top task to estimate (without claiming)
      const { data: nextTask } = await db
        .from('task_queue')
        .select('id, task, description, metadata, status')
        .eq('status', 'queued')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!nextTask) {
        // Queue empty — drain
        const drained = await drainSession(budgetSession.id, 'queue_empty')
        if (drained) {
          void sendDrainSummary(drained)
          void recordAttribution(
            { actor_type: 'cron', actor_id: 'harness' },
            { type: 'work_budget_sessions', id: budgetSession.id },
            'budget_session_closed',
            {
              used_minutes: drained.used_minutes,
              completed_count: drained.completed_count,
              close_reason: 'drained',
            }
          )
        }
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

      const taskRow = nextTask as {
        id: string
        task: string
        description: string | null
        metadata: Record<string, unknown>
        status: string
      }

      // Skip awaiting_review tasks — escalation isolation (§6)
      if (taskRow.status === 'awaiting_review') {
        const duration_ms = Date.now() - start
        await logEvent(runId, 'success', taskRow.id, 'skipped-awaiting-review', duration_ms)
        return {
          ok: true,
          claimed: null,
          reason: 'skipped-awaiting-review',
          run_id: runId,
          duration_ms,
          ...(cancelledIds.length ? { cancelled_tasks: cancelledIds } : {}),
        }
      }

      const estimate = await estimateTask({
        task: taskRow.task,
        description: taskRow.description,
        metadata: taskRow.metadata,
      })
      estimatedMinutes = estimate.estimated_minutes

      // Write estimated_minutes to task_queue
      const db2 = createServiceClient()
      void db2
        .from('task_queue')
        .update({ estimated_minutes: estimate.estimated_minutes })
        .eq('id', taskRow.id)
    } catch {
      // Estimation failure is non-fatal — proceed with MIN_CLAIMABLE_MINUTES fallback
    }

    if (!canClaimNextTask(budgetSession, estimatedMinutes)) {
      // Budget exhausted — drain (soft stop: no new claims)
      const drained = await drainSession(budgetSession.id, 'budget_exhausted')
      if (drained) {
        void sendDrainSummary(drained)
        void recordAttribution(
          { actor_type: 'cron', actor_id: 'harness' },
          { type: 'work_budget_sessions', id: budgetSession.id },
          'budget_session_closed',
          {
            used_minutes: drained.used_minutes,
            completed_count: drained.completed_count,
            close_reason: 'drained',
          }
        )
      }
      const duration_ms = Date.now() - start
      await logEvent(runId, 'success', null, 'budget-exhausted', duration_ms)
      return {
        ok: true,
        claimed: null,
        reason: 'budget-exhausted',
        run_id: runId,
        duration_ms,
        ...(cancelledIds.length ? { cancelled_tasks: cancelledIds } : {}),
      }
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

  // Attribution: one row per successful task claim
  void recordAttribution(
    {
      actor_type: 'task_pickup_cron',
      actor_id: 'task-pickup',
      run_id: runId,
    },
    { type: 'task_queue', id: task.id },
    'claimed',
    { task: task.task, source: task.source }
  )

  // F18: latency_ms — time from task creation to claim
  const latencyMs = task.created_at ? Date.now() - new Date(task.created_at).getTime() : null

  // F18: queue_depth — count of remaining queued tasks after this claim
  let queueDepth: number | null = null
  try {
    const db = createServiceClient()
    const { count } = await db
      .from('task_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued')
    queueDepth = count
  } catch {
    // Non-fatal — pickup already succeeded; depth is informational only
  }

  // Step 4: agent_events row — inserted first so its UUID can go in the button callback_data
  const duration_ms = Date.now() - start
  const eventId = await logEvent(
    runId,
    'success',
    task.id,
    `claimed: ${task.task}`,
    duration_ms,
    'task_pickup',
    {
      latency_ms: latencyMs,
      queue_depth: queueDepth,
    }
  )

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

// ── Completion hook (called by coordinator after task completes) ──────────────
// Writes actual_minutes + estimation_error_pct to task_queue.
// Logs estimation.complete to agent_events.
// Triggers calibration after every 10 completions.

// Module-level counter for calibration trigger
let _completionCounter = 0

export async function onTaskComplete(params: {
  taskId: string
  claimedAt: string | null
  completedAt: string
  estimatedMinutes: number | null
  bucket: string | null
  keywordsHit: string[]
  method: string | null
}): Promise<void> {
  const { taskId, claimedAt, completedAt, estimatedMinutes, bucket, keywordsHit, method } = params

  // Compute actual_minutes
  let actualMinutes: number | null = null
  if (claimedAt) {
    const claimedMs = new Date(claimedAt).getTime()
    const completedMs = new Date(completedAt).getTime()
    actualMinutes = Math.round((completedMs - claimedMs) / 60_000)
  }

  // Compute estimation_error_pct
  let estimationErrorPct: number | null = null
  if (estimatedMinutes != null && actualMinutes != null && estimatedMinutes > 0) {
    estimationErrorPct = Math.round(((actualMinutes - estimatedMinutes) / estimatedMinutes) * 100)
  }

  // Write to task_queue
  try {
    const db = createServiceClient()
    const updatePayload: Record<string, unknown> = {}
    if (actualMinutes !== null) updatePayload.actual_minutes = actualMinutes
    if (estimationErrorPct !== null) updatePayload.estimation_error_pct = estimationErrorPct

    if (Object.keys(updatePayload).length > 0) {
      await db.from('task_queue').update(updatePayload).eq('id', taskId)
    }
  } catch {
    // Non-fatal
  }

  // Log estimation.complete to agent_events
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'work_budget',
      action: 'estimation.complete',
      actor: 'system',
      status: 'success',
      task_type: 'estimation_complete',
      output_summary: `estimation complete: estimated=${estimatedMinutes ?? 'n/a'} actual=${actualMinutes ?? 'n/a'} error=${estimationErrorPct ?? 'n/a'}%`,
      meta: {
        estimated_minutes: estimatedMinutes,
        actual_minutes: actualMinutes,
        estimation_error_pct: estimationErrorPct,
        bucket,
        keywords_hit: keywordsHit,
        method,
        task_id: taskId,
      },
      tags: ['work_budget', 'calibration'],
    })
  } catch {
    // Non-fatal
  }

  // Budget session: update used_minutes
  try {
    const session = await getActiveSession()
    if (session && actualMinutes !== null) {
      const updated = await incrementBudgetUsedMinutes(session, actualMinutes)

      // Check if budget is now exhausted
      if (updated) {
        const remaining = updated.budget_minutes - updated.used_minutes
        if (remaining < MIN_CLAIMABLE_MINUTES) {
          const drained = await drainSession(session.id, 'budget_exhausted')
          if (drained) {
            void sendDrainSummary(drained)
            void recordAttribution(
              { actor_type: 'cron', actor_id: 'harness' },
              { type: 'work_budget_sessions', id: session.id },
              'budget_session_closed',
              {
                used_minutes: drained.used_minutes,
                completed_count: drained.completed_count,
                close_reason: 'drained',
              }
            )
          }
        } else {
          // F17: log task_completed event
          void logKnowledgeEvent('work_budget', 'work_budget.task_completed', {
            actor: 'system',
            status: 'success',
            meta: {
              session_id: session.id,
              budget_minutes: session.budget_minutes,
              used_minutes: updated.used_minutes,
              completed_count: updated.completed_count,
              task_id: taskId,
            },
          })
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // Trigger calibration after every 10 completions
  _completionCounter += 1
  if (_completionCounter % 10 === 0) {
    void runCalibration().catch(() => {})
  }
}
