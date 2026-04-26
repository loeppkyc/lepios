/**
 * Harness Stall-Check — Sprint 5 stall-alert chunk
 *
 * Detects stuck-state conditions in the autonomous harness and fires
 * Telegram alerts via outbound_notifications (one per unique trigger+id
 * per 24h window). Called by the task-pickup cron BEFORE claim logic.
 *
 * Triggers:
 *   T1 — Coordinator stuck on same task >30 min, no heartbeat
 *   T2 — Active budget session, no task completed in 30 min
 *   T3 — Task stale in queue (queued + retry_count=0 + created_at > 8h)
 *   T5 — Pickup cron missed >2 expected runs (>48h gap)
 *   T4 — morning_digest only (not fired here)
 *
 * F18 benchmark: alert-to-resolution latency p50 < 24h, p95 < 48h.
 * Surface: SELECT meta->>'trigger', percentile_cont(0.5) WITHIN GROUP
 *   (ORDER BY (meta->>'alert_latency_ms')::int)
 *   FROM agent_events WHERE action='stall_alert_sent' GROUP BY 1
 */

import { createServiceClient } from '@/lib/supabase/service'

// ── Types ─────────────────────────────────────────────────────────────────────

export type StallTrigger = 'T1' | 'T2' | 'T3' | 'T5'

export interface StallEvent {
  trigger: StallTrigger
  correlation_id: string
  description: string
  stuck_since: string // ISO timestamp
  action_text: string
}

export interface StallCheckResult {
  alerts_fired: number
  alerts_deduped: number
  triggers_checked: StallTrigger[]
  errors: string[]
}

// ── Human-readable duration helper ───────────────────────────────────────────

export function humanDuration(since: string): string {
  const diffMs = Date.now() - new Date(since).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hrs}h ${rem}min` : `${hrs}h`
}

// ── Alert message builder ────────────────────────────────────────────────────

export function buildAlertMessage(triggerLabel: string, event: StallEvent): string {
  return [
    `⚠️ [LepiOS Harness] ${triggerLabel}`,
    `Stuck: ${event.description}`,
    `Since: ${humanDuration(event.stuck_since)}`,
    `Action: ${event.action_text}`,
  ].join('\n')
}

// ── Trigger labels ────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<StallTrigger, string> = {
  T1: 'Coordinator stuck — no heartbeat >30 min',
  T2: 'Budget session active — no task completed in 30 min',
  T3: 'Task stale in queue — queued >8h, 0 retries',
  T5: 'Pickup cron missed >2 expected runs (>48h gap)',
}

// ── 24h dedup check ───────────────────────────────────────────────────────────

async function isDuplicate(trigger: StallTrigger, correlationId: string): Promise<boolean> {
  try {
    const db = createServiceClient()
    const { data } = await db
      .from('agent_events')
      .select('id')
      .eq('action', 'stall_alert_sent')
      .filter('meta->>trigger', 'eq', trigger)
      .filter('meta->>correlation_id', 'eq', correlationId)
      .gte('occurred_at', new Date(Date.now() - 24 * 3_600_000).toISOString())
      .limit(1)
      .maybeSingle()

    return data != null
  } catch {
    // If dedup check fails, allow the alert to fire (fail open for safety)
    return false
  }
}

// ── Log stall_alert_sent event ────────────────────────────────────────────────

async function logStallAlertSent(event: StallEvent): Promise<void> {
  try {
    const db = createServiceClient()
    const alertLatencyMs = Date.now() - new Date(event.stuck_since).getTime()
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'stall_alert_sent',
      actor: 'stall-check',
      status: 'success',
      task_type: 'stall_check',
      output_summary: `stall alert fired: ${event.trigger} — ${event.description}`,
      meta: {
        trigger: event.trigger,
        correlation_id: event.correlation_id,
        stuck_since: event.stuck_since,
        alert_latency_ms: alertLatencyMs,
      },
      tags: ['stall_check', 'harness'],
    })
  } catch {
    // Non-fatal — alert was already queued in outbound_notifications
  }
}

// ── Insert outbound_notifications row ─────────────────────────────────────────

async function queueAlert(event: StallEvent): Promise<void> {
  const db = createServiceClient()
  const text = buildAlertMessage(TRIGGER_LABELS[event.trigger], event)
  await db.from('outbound_notifications').insert({
    channel: 'telegram',
    payload: { text },
    correlation_id: `stall_${event.trigger}_${event.correlation_id}`,
    requires_response: false,
  })
}

// ── T1 detection: coordinator stuck >30 min ───────────────────────────────────

async function detectT1(): Promise<StallEvent[]> {
  try {
    const db = createServiceClient()
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString()
    const { data, error } = await db
      .from('task_queue')
      .select('id, task, last_heartbeat_at')
      .eq('status', 'running')
      .lt('last_heartbeat_at', cutoff)
      .limit(5) // cap — alert on up to 5 stuck tasks per run

    if (error || !data) return []

    return (data as { id: string; task: string; last_heartbeat_at: string }[]).map((row) => ({
      trigger: 'T1' as StallTrigger,
      correlation_id: row.id,
      description: `Task ${row.id.slice(0, 8)} — ${row.task.slice(0, 60)}`,
      stuck_since: row.last_heartbeat_at,
      action_text: `Reset task: UPDATE task_queue SET status='queued', claimed_at=null, last_heartbeat_at=null WHERE id='${row.id}'`,
    }))
  } catch {
    return []
  }
}

// ── T2 detection: active budget session, no task completed in 30 min ─────────
// If work_budget_sessions table does not exist, returns [] (no-op stub).
// TODO: revisit T2 if work_budget_sessions is dropped or renamed.

async function detectT2(): Promise<StallEvent[]> {
  try {
    const db = createServiceClient()

    // Find active budget sessions
    const { data: sessions, error: sessErr } = await db
      .from('work_budget_sessions')
      .select('id, started_at')
      .eq('status', 'active')
      .limit(3)

    if (sessErr || !sessions || sessions.length === 0) return []

    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString()
    const events: StallEvent[] = []

    for (const session of sessions as { id: string; started_at: string }[]) {
      // Check if any task completed in the last 30 min
      const { data: recentCompleted } = await db
        .from('task_queue')
        .select('id')
        .in('status', ['completed', 'grounded'])
        .gte('completed_at', cutoff)
        .limit(1)
        .maybeSingle()

      if (!recentCompleted) {
        events.push({
          trigger: 'T2' as StallTrigger,
          correlation_id: session.id,
          description: `Budget session ${session.id.slice(0, 8)} — no task completed in 30 min`,
          stuck_since: cutoff,
          action_text: 'Budget session will expire naturally — or send /stop to budget bot',
        })
      }
    }

    return events
  } catch {
    // T2 is a no-op if table doesn't exist or query fails
    return []
  }
}

// ── T3 detection: task stale in queue (queued + retry_count=0 + created_at >8h)

async function detectT3(): Promise<StallEvent[]> {
  try {
    const db = createServiceClient()
    const cutoff = new Date(Date.now() - 8 * 3_600_000).toISOString()
    const { data, error } = await db
      .from('task_queue')
      .select('id, task, created_at')
      .eq('status', 'queued')
      .eq('retry_count', 0)
      .lt('created_at', cutoff)
      .limit(5)

    if (error || !data) return []

    return (data as { id: string; task: string; created_at: string }[]).map((row) => ({
      trigger: 'T3' as StallTrigger,
      correlation_id: row.id,
      description: `Task ${row.id.slice(0, 8)} — ${row.task.slice(0, 60)}`,
      stuck_since: row.created_at,
      action_text: `Cancel or reprioritize: UPDATE task_queue SET status='cancelled' WHERE id='${row.id}'`,
    }))
  } catch {
    return []
  }
}

// ── T5 detection: pickup cron missed >2 expected runs (>48h gap) ──────────────

async function detectT5(): Promise<StallEvent[]> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('agent_events')
      .select('occurred_at')
      .eq('action', 'task_pickup')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return []

    // If no pickup event exists at all, use epoch as stuck_since
    const lastPickup = data?.occurred_at ?? new Date(0).toISOString()
    const gapMs = Date.now() - new Date(lastPickup).getTime()

    if (gapMs > 48 * 3_600_000) {
      return [
        {
          trigger: 'T5' as StallTrigger,
          correlation_id: 'cron_gap',
          description: `Pickup cron last ran ${humanDuration(lastPickup)} ago (expected every 24h)`,
          stuck_since: lastPickup,
          action_text: 'Check Vercel cron logs — cron may be paused or misconfigured',
        },
      ]
    }

    return []
  } catch {
    return []
  }
}

// ── T3 + T4 queries for morning_digest summary line ───────────────────────────
// Returns counts and descriptions for the digest stall summary line.
// Not deduped — always reflects current state.

export async function getDigestStallSummary(): Promise<{
  count: number
  descriptions: string[]
}> {
  try {
    const db = createServiceClient()
    const t3Cutoff = new Date(Date.now() - 8 * 3_600_000).toISOString()
    const t4Cutoff = new Date(Date.now() - 24 * 3_600_000).toISOString()

    const [t3Result, t4Result] = await Promise.all([
      db
        .from('task_queue')
        .select('id, task, created_at')
        .eq('status', 'queued')
        .eq('retry_count', 0)
        .lt('created_at', t3Cutoff)
        .limit(5),
      db
        .from('task_queue')
        .select('id, task, created_at')
        .eq('status', 'awaiting_review')
        .lt('created_at', t4Cutoff)
        .limit(5),
    ])

    const rows = [
      ...((t3Result.data ?? []) as { id: string; task: string }[]),
      ...((t4Result.data ?? []) as { id: string; task: string }[]),
    ]

    const descriptions = rows.map((r) => `${r.id.slice(0, 8)} — ${r.task.slice(0, 40)}`)

    return { count: rows.length, descriptions }
  } catch {
    return { count: 0, descriptions: [] }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runStallCheck(): Promise<StallCheckResult> {
  const result: StallCheckResult = {
    alerts_fired: 0,
    alerts_deduped: 0,
    triggers_checked: ['T1', 'T2', 'T3', 'T5'],
    errors: [],
  }

  // Collect all candidate stall events
  let candidates: StallEvent[] = []
  try {
    const [t1, t2, t3, t5] = await Promise.all([detectT1(), detectT2(), detectT3(), detectT5()])
    candidates = [...t1, ...t2, ...t3, ...t5]
  } catch (err) {
    result.errors.push(`detection error: ${String(err)}`)
    return result
  }

  // For each candidate: dedup check → queue alert + log event
  for (const event of candidates) {
    try {
      const alreadySent = await isDuplicate(event.trigger, event.correlation_id)
      if (alreadySent) {
        result.alerts_deduped++
        continue
      }

      await queueAlert(event)
      await logStallAlertSent(event)
      result.alerts_fired++
    } catch (err) {
      result.errors.push(`alert error for ${event.trigger}/${event.correlation_id}: ${String(err)}`)
    }
  }

  return result
}
