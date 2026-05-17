// Harness approval listener — Option C.
//
// Called from the Telegram webhook when a task is approved via button or text.
// Reads BUILDER_ROUTINE_ID from harness_config; if set, inserts a
// builder_needed outbound_notification so Colin is alerted, then fires the
// builder routine automatically via invoke-builder.ts.
//
// Deduplication guard: if task_queue.metadata.pending_notification_id is set,
// the approval came through coordinator-resume (which already handles re-queuing
// via pickup). In that case, skip the direct builder fire to avoid duplicate
// invocations and log approval_listener_skipped_dedup instead.
//
// Non-fatal — errors are swallowed; webhook always returns 200.

import { createServiceClient } from '@/lib/supabase/service'
import { fireBuilder } from '@/lib/harness/invoke-builder'

export async function handleApprovedTask(taskId: string): Promise<void> {
  const db = createServiceClient()

  // Read BUILDER_ROUTINE_ID to confirm builder is configured before proceeding
  const { data } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'BUILDER_ROUTINE_ID')
    .maybeSingle<{ value: string }>()

  const routineId = data?.value?.trim()
  if (!routineId) return

  // Insert the outbound notification so Colin is informed regardless of the
  // builder-fire path below
  await db.from('outbound_notifications').insert({
    channel: 'telegram',
    payload: {
      text: `🔨 Task ${taskId.slice(0, 8)} approved — firing builder automatically.`,
    },
    correlation_id: `builder_needed_${taskId}`,
    requires_response: false,
  })

  // Deduplication guard: read the task to check for coordinator-resume pending
  const { data: taskRow } = await db
    .from('task_queue')
    .select('metadata')
    .eq('id', taskId)
    .maybeSingle<{ metadata: Record<string, unknown> | null }>()

  const meta = taskRow?.metadata ?? {}
  const hasPendingNotification = Boolean(meta.pending_notification_id)

  if (hasPendingNotification) {
    // This approval came through coordinator-resume; it already handles re-queuing
    // via pickup. Skip the direct builder fire to avoid duplicate sessions.
    try {
      await db.from('agent_events').insert({
        id: crypto.randomUUID(),
        domain: 'orchestrator',
        action: 'approval_listener_skipped_dedup',
        actor: 'harness',
        task_type: 'approval_listener',
        status: 'info',
        output_summary: `Skipped direct builder fire for task ${taskId.slice(0, 8)} — coordinator-resume pending_notification_id present`,
        meta: { task_id: taskId },
        tags: ['harness', 'approval-listener', 'dedup'],
      })
    } catch {
      // Non-fatal
    }
    return
  }

  // No coordinator-resume pending — fire builder directly
  const runId = crypto.randomUUID()
  const result = await fireBuilder({ task_id: taskId, run_id: runId })

  try {
    if (result.ok) {
      await db.from('agent_events').insert({
        id: crypto.randomUUID(),
        domain: 'orchestrator',
        action: 'approval_listener_fired',
        actor: 'harness',
        task_type: 'approval_listener',
        status: 'success',
        output_summary: `Builder fired for task ${taskId.slice(0, 8)}, session ${result.session_id}`,
        meta: {
          task_id: taskId,
          run_id: runId,
          session_id: result.session_id,
          session_url: result.session_url,
        },
        tags: ['harness', 'approval-listener'],
      })
    } else {
      await db.from('agent_events').insert({
        id: crypto.randomUUID(),
        domain: 'orchestrator',
        action: 'approval_listener_fired',
        actor: 'harness',
        task_type: 'approval_listener',
        status: 'error',
        output_summary: `Builder fire failed for task ${taskId.slice(0, 8)}: ${result.error}`,
        meta: {
          task_id: taskId,
          run_id: runId,
          error: result.error,
          failure_type: result.failure_type,
          ...(result.upstream_status !== undefined
            ? { upstream_status: result.upstream_status }
            : {}),
        },
        tags: ['harness', 'approval-listener'],
      })
    }
  } catch {
    // Non-fatal — event write failure must not block the caller
  }
}
