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

// ── Build drain summary message (§4a) ─────────────────────────────────────────

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

// ── Insert Telegram summary into outbound_notifications ──────────────────────

export async function sendDrainSummary(session: WorkBudgetSession): Promise<void> {
  try {
    const db = createServiceClient()

    // Count awaiting_review tasks
    const { count: awaitingCount } = await db
      .from('task_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'awaiting_review')

    // Count remaining queued tasks
    const { count: queuedCount } = await db
      .from('task_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued')

    const fullyDrained = (queuedCount ?? 0) === 0 && (awaitingCount ?? 0) === 0
    const text = buildDrainSummary(session, {
      awaitingReviewCount: awaitingCount ?? 0,
      queuedCount: queuedCount ?? 0,
      fullyDrained,
    })

    await db.from('outbound_notifications').insert({
      channel: 'telegram',
      payload: { text },
      correlation_id: `budget_drain_${session.id}`,
      requires_response: false,
      ...(session.telegram_chat_id ? { chat_id: session.telegram_chat_id } : {}),
    })

    // F17: log drain event
    void logKnowledgeEvent('work_budget', 'work_budget.drained', {
      actor: 'system',
      status: 'success',
      meta: {
        session_id: session.id,
        budget_minutes: session.budget_minutes,
        used_minutes: session.used_minutes,
        completed_count: session.completed_count,
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
