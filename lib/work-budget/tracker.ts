/**
 * Work-Budget Tracker
 *
 * State lives in `work_budget_sessions` table. Handles:
 * - Active session lookup
 * - Budget check before task claim
 * - used_minutes update after task completion
 * - Drain detection and Telegram summary
 */

import { createServiceClient } from '@/lib/supabase/service'
import { logEvent as logKnowledgeEvent } from '@/lib/knowledge/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkBudgetSession {
  id: string
  status: 'active' | 'drained' | 'stopped'
  budget_minutes: number
  used_minutes: number
  completed_count: number
  started_at: string
  completed_at: string | null
  source: string
  telegram_chat_id: string | null
  metadata: Record<string, unknown>
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const MIN_CLAIMABLE_MINUTES = 10

// ── Active session lookup ─────────────────────────────────────────────────────

export async function getActiveSession(): Promise<WorkBudgetSession | null> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('work_budget_sessions')
      .select('*')
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return null
    return (data as WorkBudgetSession | null) ?? null
  } catch {
    return null
  }
}

// ── Budget check ──────────────────────────────────────────────────────────────
// Returns true if a new task with the given estimate can be claimed.
// If remaining >= estimatedMinutes → true.
// If remaining > 0 but estimate exceeds remaining → claim anyway if >= MIN_CLAIMABLE_MINUTES.

export function canClaimNextTask(session: WorkBudgetSession, nextTaskEstimate: number): boolean {
  const remaining = session.budget_minutes - session.used_minutes
  return remaining >= nextTaskEstimate || remaining >= MIN_CLAIMABLE_MINUTES
}

// ── Direct used_minutes update ────────────────────────────────────────────────

export async function incrementBudgetUsedMinutes(
  session: WorkBudgetSession,
  actualMinutes: number
): Promise<WorkBudgetSession | null> {
  try {
    const db = createServiceClient()
    const newUsed = session.used_minutes + actualMinutes
    const newCompleted = session.completed_count + 1

    const { data, error } = await db
      .from('work_budget_sessions')
      .update({
        used_minutes: newUsed,
        completed_count: newCompleted,
      })
      .eq('id', session.id)
      .eq('status', 'active')
      .select('*')
      .maybeSingle()

    if (error) return null
    return (data as WorkBudgetSession | null) ?? null
  } catch {
    return null
  }
}

// ── Drain session ─────────────────────────────────────────────────────────────

export async function drainSession(
  sessionId: string,
  reason: 'budget_exhausted' | 'queue_empty'
): Promise<WorkBudgetSession | null> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('work_budget_sessions')
      .update({
        status: 'drained',
        completed_at: new Date().toISOString(),
        metadata: { drain_reason: reason },
      })
      .eq('id', sessionId)
      .eq('status', 'active')
      .select('*')
      .maybeSingle()

    if (error) return null
    return (data as WorkBudgetSession | null) ?? null
  } catch {
    return null
  }
}

// ── Stop session (user-initiated) ─────────────────────────────────────────────

export async function stopSession(sessionId: string): Promise<WorkBudgetSession | null> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('work_budget_sessions')
      .update({
        status: 'stopped',
        completed_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('status', 'active')
      .select('*')
      .maybeSingle()

    if (error) return null
    return (data as WorkBudgetSession | null) ?? null
  } catch {
    return null
  }
}

// ── Build drain summary message (§4a) — legacy format, kept for callers ──────

export function buildDrainSummary(
  session: WorkBudgetSession,
  opts: {
    awaitingReviewCount: number
    queuedCount: number
    fullyDrained?: boolean
  }
): string {
  const lines = [
    `⏱ Budget window closed: ${session.used_minutes}m / ${session.budget_minutes}m used.`,
    `✅ ${session.completed_count} tasks completed`,
    `⏸ ${opts.awaitingReviewCount} escalations pending your reply`,
    `🗂 ${opts.queuedCount} tasks remain in queue`,
  ]

  if (opts.awaitingReviewCount > 0) {
    lines.push('Reply to pending escalations to unblock queued work.')
  }

  if (opts.fullyDrained) {
    lines.push('Queue fully drained — all eligible work completed.')
  }

  return lines.join('\n')
}

// ── Task row shape for budget summary ────────────────────────────────────────

interface TaskSummaryRow {
  id: string
  task: string
}

// ── Build new-format budget summary message ───────────────────────────────────
// Format matches acceptance doc §Summary message content.

export function buildBudgetSummaryText(
  session: WorkBudgetSession,
  opts: {
    claimedTasks: TaskSummaryRow[]
    completedTasks: TaskSummaryRow[]
    awaitingTasks: TaskSummaryRow[]
    durationMinutes: number
  }
): string {
  const shortId = session.id.slice(0, 8)
  const startedLabel = session.started_at
    ? new Date(session.started_at).toISOString().slice(0, 16).replace('T', ' ')
    : '?'
  const endedLabel = session.completed_at
    ? new Date(session.completed_at).toISOString().slice(0, 16).replace('T', ' ')
    : '?'

  const lines: string[] = [
    `[LepiOS Budget] Session ${shortId} ended — ${session.status}`,
    `Duration: ${opts.durationMinutes} min (${startedLabel} → ${endedLabel})`,
  ]

  function taskLines(tasks: TaskSummaryRow[]): string[] {
    return tasks.map((t) => {
      const tid = t.id.slice(0, 8)
      const desc = t.task.length > 40 ? t.task.slice(0, 40) : t.task
      return `  • ${tid} — ${desc}`
    })
  }

  if (opts.claimedTasks.length > 0) {
    lines.push('')
    lines.push(`Tasks claimed (${opts.claimedTasks.length}):`)
    lines.push(...taskLines(opts.claimedTasks))
  }

  if (opts.completedTasks.length > 0) {
    lines.push('')
    lines.push(`Tasks completed (${opts.completedTasks.length}):`)
    lines.push(...taskLines(opts.completedTasks))
  }

  if (opts.awaitingTasks.length > 0) {
    lines.push('')
    lines.push(`Awaiting review/grounding (${opts.awaitingTasks.length}):`)
    lines.push(...taskLines(opts.awaitingTasks))
  }

  // Cost line omitted: cost_log table does not exist in v1

  return lines.join('\n')
}

// ── Insert Telegram summary into outbound_notifications ──────────────────────
// Handles both 'drained' and 'stopped' terminal statuses.
// Deduplicates via session.metadata.budget_summary_sent.

export async function sendDrainSummary(session: WorkBudgetSession): Promise<void> {
  try {
    // Dedup: skip if already sent for this session
    if (session.metadata?.budget_summary_sent) return

    const db = createServiceClient()

    // Determine time window for task queries
    const windowStart = session.started_at
    const windowEnd = session.completed_at ?? new Date().toISOString()

    // Claimed tasks in the session window
    const { data: claimedRaw } = await db
      .from('task_queue')
      .select('id, task')
      .gte('claimed_at', windowStart)
      .lte('claimed_at', windowEnd)

    const claimedTasks: TaskSummaryRow[] = (claimedRaw ?? []) as TaskSummaryRow[]

    // Completed tasks in the session window
    const { data: completedRaw } = await db
      .from('task_queue')
      .select('id, task')
      .eq('status', 'completed')
      .gte('claimed_at', windowStart)
      .lte('claimed_at', windowEnd)

    const completedTasks: TaskSummaryRow[] = (completedRaw ?? []) as TaskSummaryRow[]

    // Awaiting review/grounding tasks in the session window
    const { data: awaitingRaw } = await db
      .from('task_queue')
      .select('id, task')
      .in('status', ['awaiting_review', 'awaiting_grounding'])
      .gte('claimed_at', windowStart)
      .lte('claimed_at', windowEnd)

    const awaitingTasks: TaskSummaryRow[] = (awaitingRaw ?? []) as TaskSummaryRow[]

    // Duration in minutes
    const startMs = new Date(session.started_at).getTime()
    const endMs = new Date(windowEnd).getTime()
    const durationMinutes = Math.round((endMs - startMs) / 60_000)

    const text = buildBudgetSummaryText(session, {
      claimedTasks,
      completedTasks,
      awaitingTasks,
      durationMinutes,
    })

    // correlation_id varies by terminal status
    const correlationId =
      session.status === 'stopped' ? `budget_stop_${session.id}` : `budget_drain_${session.id}`

    await db.from('outbound_notifications').insert({
      channel: 'telegram',
      payload: { text },
      correlation_id: correlationId,
      requires_response: false,
      ...(session.telegram_chat_id ? { chat_id: session.telegram_chat_id } : {}),
    })

    // Mark dedup flag on session metadata (JSONB merge)
    await db
      .from('work_budget_sessions')
      .update({
        metadata: {
          ...((session.metadata as Record<string, unknown>) ?? {}),
          budget_summary_sent: true,
        },
      })
      .eq('id', session.id)

    // F18: log budget_summary_sent event to agent_events
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'budget_summary_sent',
      actor: 'budget-summary',
      status: 'success',
      meta: {
        session_id: session.id,
        session_status: session.status,
        tasks_claimed: claimedTasks.length,
        tasks_completed: completedTasks.length,
        tasks_awaiting: awaitingTasks.length,
        duration_minutes: durationMinutes,
      },
    })
  } catch {
    // Non-fatal
  }
}

// ── Status message (§2a) ──────────────────────────────────────────────────────

export async function buildStatusMessage(session: WorkBudgetSession): Promise<string> {
  try {
    const db = createServiceClient()

    const remaining = session.budget_minutes - session.used_minutes

    // Count in-progress tasks (claimed but not completed)
    const { count: inProgressCount } = await db
      .from('task_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'claimed')

    // Count queued tasks
    const { count: queuedCount } = await db
      .from('task_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued')

    // Peek at next task
    const { data: nextTask } = await db
      .from('task_queue')
      .select('task')
      .eq('status', 'queued')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    const nextTitle = (nextTask as { task: string } | null)?.task?.slice(0, 60) ?? 'queue empty'

    return [
      `⏱ Budget: ${session.used_minutes}m used / ${session.budget_minutes}m — ${remaining}m remaining`,
      `✅ Completed: ${session.completed_count} tasks`,
      `🔄 In progress: ${inProgressCount ?? 0}`,
      `⏳ Queued: ${queuedCount ?? 0}`,
      `📋 Next: ${nextTitle}`,
    ].join('\n')
  } catch {
    const remaining = session.budget_minutes - session.used_minutes
    return `⏱ Budget: ${session.used_minutes}m used / ${session.budget_minutes}m — ${remaining}m remaining`
  }
}
