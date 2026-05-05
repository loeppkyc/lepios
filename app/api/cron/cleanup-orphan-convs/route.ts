import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Cleanup cron — deletes orphan conversations.
 *
 * An "orphan" is a row in `conversations` with message_count < 2 and
 * created_at older than 24h. This happens when a /api/chat send fails
 * mid-stream after the user message has already persisted but before
 * the assistant onFinish appends. The sidebar already hides these (see
 * lib/orb/persistence.ts:listConversations), but the rows accumulate
 * in the DB. This cron prunes them.
 *
 * Companion to e38f3f2 (sidebar filter).
 *
 * - The 24h grace window prevents racing with an in-flight stream that
 *   created the conv "just now" and hasn't yet appended the assistant
 *   message.
 * - `messages` rows are removed via ON DELETE CASCADE on
 *   conversations(id) (see migration 0042).
 * - Deletions are logged to agent_events with the count and a sample
 *   of deleted ids; idempotent on empty days (writes a `success` row
 *   with deleted=0).
 */
export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const db = createServiceClient()
  const started = Date.now()
  const cutoff = new Date(Date.now() - 24 * 3_600_000).toISOString()

  const { data: deleted, error } = await db
    .from('conversations')
    .delete()
    .lt('message_count', 2)
    .lt('created_at', cutoff)
    .select('id')

  if (error) {
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'cleanup_orphan_convs',
      actor: 'cron_cleanup_orphan_convs',
      status: 'error',
      duration_ms: Date.now() - started,
      output_summary: `delete failed: ${error.message}`,
      meta: { error: error.message },
    })
    return NextResponse.json(
      { ok: false, error: `delete failed: ${error.message}` },
      { status: 500 }
    )
  }

  const count = deleted?.length ?? 0
  const sampleIds = (deleted ?? []).slice(0, 10).map((r) => r.id as string)

  await db.from('agent_events').insert({
    domain: 'orchestrator',
    action: 'cleanup_orphan_convs',
    actor: 'cron_cleanup_orphan_convs',
    status: 'success',
    duration_ms: Date.now() - started,
    output_summary: `pruned ${count} orphan conversation${count === 1 ? '' : 's'}`,
    meta: { deleted: count, cutoff, sample_ids: sampleIds },
  })

  return NextResponse.json({ ok: true, deleted: count, cutoff })
}

export async function POST(request: Request) {
  return GET(request)
}
