/**
 * lib/purpose-review/timeout.ts
 *
 * Timeout checker for purpose_review awaiting_review tasks.
 * Called from the task-pickup cron or a dedicated cron route.
 *
 * Finds tasks where status='awaiting_review' AND last_heartbeat_at is more than
 * 72 hours old. For each: sets status='review_timeout', fires Telegram alert.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { telegram } from '@/lib/harness/arms-legs/telegram'

const REVIEW_TIMEOUT_HOURS = 72

async function fireTimeoutAlert(modulePath: string, taskId: string): Promise<void> {
  const text =
    `⏰ Review timeout: ${modulePath} — no reply in ${REVIEW_TIMEOUT_HOURS}h. ` +
    `Reply /review ${taskId} approve|skip to unblock.`
  await telegram(text, { bot: 'alerts', agentId: 'purpose_review' }).catch(() => {})
}

/**
 * Finds all task_queue rows where:
 *   - status = 'awaiting_review'
 *   - last_heartbeat_at < NOW() - INTERVAL '72 hours'
 *
 * For each: sets status='review_timeout', updates metadata, fires Telegram alert.
 * Returns the count of rows timed out.
 */
export async function checkPurposeReviewTimeouts(db?: SupabaseClient): Promise<number> {
  const client = db ?? createServiceClient()

  const cutoff = new Date(Date.now() - REVIEW_TIMEOUT_HOURS * 60 * 60 * 1000).toISOString()

  const { data: timedOutRows, error } = await client
    .from('task_queue')
    .select('id, metadata')
    .eq('status', 'awaiting_review')
    .lt('last_heartbeat_at', cutoff)

  if (error || !timedOutRows || timedOutRows.length === 0) {
    return 0
  }

  let count = 0
  for (const row of timedOutRows as { id: string; metadata: Record<string, unknown> }[]) {
    const meta = row.metadata ?? {}
    const modulePath = (meta.module_path as string) ?? 'unknown'

    const { error: updateError } = await client
      .from('task_queue')
      .update({
        status: 'review_timeout',
        metadata: { ...meta, purpose_review: 'review_timeout' },
      })
      .eq('id', row.id)

    if (!updateError) {
      count++
    }

    // Log to agent_events
    await client.from('agent_events').insert({
      domain: 'purpose_review',
      action: 'purpose_review.timeout',
      actor: 'system',
      status: updateError ? 'error' : 'success',
      task_type: 'purpose_review',
      output_summary: `purpose review timed out after ${REVIEW_TIMEOUT_HOURS}h for ${modulePath}`,
      meta: {
        task_queue_id: row.id,
        module_path: modulePath,
        error: updateError?.message ?? null,
      },
      tags: ['purpose_review', 'harness', 'timeout'],
    })

    // Fire Telegram alert regardless of update outcome
    await fireTimeoutAlert(modulePath, row.id)
  }

  return count
}
