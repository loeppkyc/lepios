// lib/harness/auto-approve.ts
//
// Auto-approves acceptance_doc_ready tasks when the twin has confidence >= threshold.
//
// Flow:
//   1. Find pending outbound_notifications with requires_response=true that carry
//      an acceptance_doc_ready status in the payload text.
//   2. For each, query the twin asking if the approach aligns with Colin's principles.
//   3. If confidence >= threshold AND no blocking questions were flagged →
//      update task_queue.status='approved' + call handleApprovedTask.
//   4. Log every decision (approve/skip/escalate) to agent_events.
//
// Blocking-question detection: if the notification text contains keywords like
// "BLOCKING" or "required" near a question mark, auto-approve is skipped and
// the notification is left for Colin.

import { createServiceClient } from '@/lib/supabase/service'
import { askTwin, getTwinConfig } from '@/lib/twin/query'
import { handleApprovedTask } from '@/lib/harness/approval-listener'

export interface AutoApproveResult {
  considered: number
  approved: number
  skipped: number
  errors: number
  decisions: AutoApproveDecision[]
}

export interface AutoApproveDecision {
  task_id: string
  notification_id: string
  action: 'approved' | 'skipped' | 'error'
  reason: string
  confidence: number | null
}

const TASK_ID_RE = /task_id:\s*([0-9a-f-]{36})/i
const BLOCKING_RE = /\bBLOCKING\b/i
const ACCEPTANCE_DOC_RE = /acceptance_doc_ready/i

function extractTaskId(text: string): string | null {
  const m = TASK_ID_RE.exec(text)
  return m ? m[1] : null
}

function hasBlockingQuestions(text: string): boolean {
  return BLOCKING_RE.test(text)
}

function buildTwinQuestion(notificationText: string): string {
  // Cap at 1200 chars so the twin doesn't choke on enormous docs
  const excerpt = notificationText.slice(0, 1200).trim()
  return (
    "Based on Colin's build principles and preferences, does this coordinator acceptance doc " +
    'look like a standard LepiOS build task that can proceed without additional input? ' +
    'The coordinator has already completed Phase 1a study and written the spec.\n\n' +
    excerpt
  )
}

export async function runAutoApprove(): Promise<AutoApproveResult> {
  const db = createServiceClient()
  const { confidenceThreshold } = getTwinConfig()

  const result: AutoApproveResult = {
    considered: 0,
    approved: 0,
    skipped: 0,
    errors: 0,
    decisions: [],
  }

  // Find pending acceptance-doc approval notifications
  const { data: notifications, error } = await db
    .from('outbound_notifications')
    .select('id, payload, correlation_id, created_at')
    .eq('status', 'pending')
    .eq('requires_response', true)
    .order('created_at', { ascending: true })
    .limit(20)

  if (error) throw new Error(`auto-approve fetch failed: ${error.message}`)

  const candidates = (notifications ?? []).filter((n) => {
    const text: string =
      typeof n.payload === 'object' && n.payload !== null && 'text' in n.payload
        ? String((n.payload as { text: string }).text)
        : ''
    return ACCEPTANCE_DOC_RE.test(text)
  })

  result.considered = candidates.length

  for (const notification of candidates) {
    const notifText =
      typeof notification.payload === 'object' &&
      notification.payload !== null &&
      'text' in notification.payload
        ? String((notification.payload as { text: string }).text)
        : ''

    const taskId = extractTaskId(notifText)

    if (!taskId) {
      result.skipped++
      result.decisions.push({
        task_id: 'unknown',
        notification_id: notification.id as string,
        action: 'skipped',
        reason: 'no_task_id_in_payload',
        confidence: null,
      })
      continue
    }

    // Never auto-approve docs with blocking questions — those need Colin
    if (hasBlockingQuestions(notifText)) {
      result.skipped++
      result.decisions.push({
        task_id: taskId,
        notification_id: notification.id as string,
        action: 'skipped',
        reason: 'blocking_questions_detected',
        confidence: null,
      })
      await db.from('agent_events').insert({
        domain: 'harness',
        action: 'auto_approve_skipped',
        actor: taskId.slice(0, 8),
        status: 'info',
        input_summary: 'blocking_questions_detected',
        meta: { task_id: taskId, notification_id: notification.id },
      })
      continue
    }

    // Query the twin
    let twinConfidence: number | null = null
    let approved = false
    try {
      const twinResp = await askTwin(buildTwinQuestion(notifText))
      twinConfidence = twinResp.confidence

      if (!twinResp.escalate && twinResp.confidence >= confidenceThreshold) {
        approved = true
      }
    } catch {
      result.errors++
      result.decisions.push({
        task_id: taskId,
        notification_id: notification.id as string,
        action: 'error',
        reason: 'twin_query_failed',
        confidence: null,
      })
      await db.from('agent_events').insert({
        domain: 'harness',
        action: 'auto_approve_error',
        actor: taskId.slice(0, 8),
        status: 'warning',
        input_summary: 'twin_query_failed',
        meta: { task_id: taskId, notification_id: notification.id },
      })
      continue
    }

    if (!approved) {
      result.skipped++
      result.decisions.push({
        task_id: taskId,
        notification_id: notification.id as string,
        action: 'skipped',
        reason: 'twin_confidence_below_threshold',
        confidence: twinConfidence,
      })
      await db.from('agent_events').insert({
        domain: 'harness',
        action: 'auto_approve_skipped',
        actor: taskId.slice(0, 8),
        status: 'info',
        input_summary: `twin_confidence=${twinConfidence?.toFixed(2)} < threshold=${confidenceThreshold}`,
        meta: { task_id: taskId, notification_id: notification.id, confidence: twinConfidence },
      })
      continue
    }

    // Approve: update task_queue + mark notification handled
    try {
      const { data: task } = await db
        .from('task_queue')
        .select('id, metadata')
        .eq('id', taskId)
        .in('status', ['awaiting_grounding', 'acceptance_doc_ready'])
        .maybeSingle()

      if (!task) {
        result.skipped++
        result.decisions.push({
          task_id: taskId,
          notification_id: notification.id as string,
          action: 'skipped',
          reason: 'task_not_found_or_wrong_status',
          confidence: twinConfidence,
        })
        continue
      }

      const existingMeta =
        ((task as { metadata?: unknown }).metadata as Record<string, unknown>) ?? {}

      await db
        .from('task_queue')
        .update({
          status: 'approved',
          metadata: {
            ...existingMeta,
            approved_via: 'auto_approve',
            approved_at: new Date().toISOString(),
            twin_confidence: twinConfidence,
          },
        })
        .eq('id', taskId)

      await db.from('outbound_notifications').update({ status: 'sent' }).eq('id', notification.id)

      await handleApprovedTask(taskId)

      await db.from('agent_events').insert({
        domain: 'harness',
        action: 'auto_approved',
        actor: taskId.slice(0, 8),
        status: 'success',
        input_summary: `twin_confidence=${twinConfidence?.toFixed(2)}`,
        meta: { task_id: taskId, notification_id: notification.id, confidence: twinConfidence },
      })

      result.approved++
      result.decisions.push({
        task_id: taskId,
        notification_id: notification.id as string,
        action: 'approved',
        reason: `twin_confidence=${twinConfidence?.toFixed(2)}`,
        confidence: twinConfidence,
      })
    } catch (err) {
      result.errors++
      result.decisions.push({
        task_id: taskId,
        notification_id: notification.id as string,
        action: 'error',
        reason: err instanceof Error ? err.message : 'approval_write_failed',
        confidence: twinConfidence,
      })
    }
  }

  return result
}
