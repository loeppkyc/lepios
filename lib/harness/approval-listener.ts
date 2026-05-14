// Harness approval listener — Option C.
//
// Called from the Telegram webhook when a task is approved via button or text.
// Reads BUILDER_ROUTINE_ID from harness_config; if set, inserts a
// builder_needed outbound_notification so Colin is alerted and the routine
// ID is surfaced for builder invocation.
//
// Non-fatal — errors are swallowed; webhook always returns 200.

import { createServiceClient } from '@/lib/supabase/service'

export async function handleApprovedTask(taskId: string): Promise<void> {
  const db = createServiceClient()

  const { data } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'BUILDER_ROUTINE_ID')
    .maybeSingle<{ value: string }>()

  const routineId = data?.value?.trim()
  if (!routineId) return

  await db.from('outbound_notifications').insert({
    channel: 'telegram',
    payload: {
      text: `🔨 Task ${taskId.slice(0, 8)} approved — builder_needed.\nBUILDER_ROUTINE_ID: ${routineId}`,
    },
    correlation_id: `builder_needed_${taskId}`,
    requires_response: false,
  })
}
