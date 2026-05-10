import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// POST { notification_id: string }
// Called by the Telegram webhook after recording response_received on an
// outbound_notifications row. Finds the task_queue row in awaiting_approval
// status whose metadata.pending_notification_id matches, writes the response
// to pending_notification_response, clears pending_notification_id, and
// transitions the task to queued (priority 1) so the pickup cron re-fires
// the coordinator immediately.
export async function POST(request: Request): Promise<NextResponse> {
  const authError = requireCronSecret(request)
  if (authError) return authError

  let notification_id: string
  try {
    const body = (await request.json()) as { notification_id?: string }
    if (!body.notification_id) {
      return NextResponse.json({ error: 'notification_id required' }, { status: 400 })
    }
    notification_id = body.notification_id
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const db = createServiceClient()

  // Read the response from outbound_notifications
  const { data: notifRow } = await db
    .from('outbound_notifications')
    .select('id, response, status')
    .eq('id', notification_id)
    .maybeSingle()

  if (!notifRow) {
    return NextResponse.json({ error: 'notification not found' }, { status: 404 })
  }

  // Find the task waiting on this notification
  const { data: taskRows } = await db
    .from('task_queue')
    .select('id, metadata')
    .eq('status', 'awaiting_approval')
    .filter('metadata->>pending_notification_id', 'eq', notification_id)
    .limit(1)

  if (!taskRows || taskRows.length === 0) {
    // Idempotent — no task to resume
    return NextResponse.json({ ok: true, action: 'no_awaiting_task' })
  }

  const task = taskRows[0] as { id: string; metadata: Record<string, unknown> }
  const existingMeta = (task.metadata ?? {}) as Record<string, unknown>

  // Write response to metadata, clear pending_notification_id, transition to queued
  const updatedMeta = { ...existingMeta }
  updatedMeta.pending_notification_response = (notifRow as { response: unknown }).response
  delete updatedMeta.pending_notification_id

  const { error: updateError } = await db
    .from('task_queue')
    .update({ status: 'queued', priority: 1, metadata: updatedMeta })
    .eq('id', task.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Log resume event
  await db
    .from('agent_events')
    .insert({
      domain: 'orchestrator',
      action: 'coordinator_resumed',
      actor: 'coordinator_resume',
      status: 'success',
      task_type: 'coordinator_resume',
      output_summary: `coordinator task ${task.id.slice(0, 8)} resumed — notification response received`,
      meta: {
        task_id: task.id,
        notification_id,
        response: (notifRow as { response: unknown }).response,
      },
      tags: ['coordinator', 'harness', 'notification'],
    })
    .catch(() => {})

  // Trigger pickup to re-invoke coordinator immediately
  const secret = process.env.CRON_SECRET
  if (secret) {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lepios-one.vercel.app'
    await fetch(`${base}/api/cron/task-pickup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, action: 'resumed', task_id: task.id })
}
