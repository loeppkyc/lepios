import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { onTaskComplete } from '@/lib/harness/pickup-runner'

export const dynamic = 'force-dynamic'

// POST /api/coordinator/complete
// Called by coordinator at end of Phase 6 to mark a task done and loop to next.
// F22-compliant: requireCronSecret enforces CRON_SECRET bearer auth.
//
// Body: {
//   task_id: string,
//   status?: 'completed' | 'failed',
//   result?: Record<string, unknown>,
//   error_message?: string,
//   claimed_at?: string,          // ISO timestamp — for estimation tracking
//   estimated_minutes?: number,
//   bucket?: string,
//   keywords_hit?: string[],
//   method?: string,
// }
// Returns: { ok: true, looped_to_next: boolean } | { ok: false, error: string }

export async function POST(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: {
    task_id?: unknown
    status?: unknown
    result?: unknown
    error_message?: unknown
    claimed_at?: unknown
    estimated_minutes?: unknown
    bucket?: unknown
    keywords_hit?: unknown
    method?: unknown
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const taskId = typeof body.task_id === 'string' ? body.task_id.trim() : ''
  if (!taskId) {
    return NextResponse.json({ ok: false, error: 'task_id is required' }, { status: 400 })
  }

  const finalStatus = body.status === 'failed' ? ('failed' as const) : ('completed' as const)
  const completedAt = new Date().toISOString()

  const db = createServiceClient()

  // Mark task complete
  const updatePayload: Record<string, unknown> = {
    status: finalStatus,
    completed_at: completedAt,
  }
  if (body.result && typeof body.result === 'object') updatePayload.result = body.result
  if (typeof body.error_message === 'string') updatePayload.error_message = body.error_message

  const { error: updateErr } = await db.from('task_queue').update(updatePayload).eq('id', taskId)

  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 })
  }

  // Run estimation tracking (non-fatal)
  void onTaskComplete({
    taskId,
    claimedAt: typeof body.claimed_at === 'string' ? body.claimed_at : null,
    completedAt,
    estimatedMinutes: typeof body.estimated_minutes === 'number' ? body.estimated_minutes : null,
    bucket: typeof body.bucket === 'string' ? body.bucket : null,
    keywordsHit: Array.isArray(body.keywords_hit)
      ? (body.keywords_hit as string[]).filter((k) => typeof k === 'string')
      : [],
    method: typeof body.method === 'string' ? body.method : null,
  }).catch(() => {})

  // Check HARNESS_HALTED before looping
  let halted = false
  try {
    const { data: haltRow } = await db
      .from('harness_config')
      .select('value')
      .eq('key', 'HARNESS_HALTED')
      .maybeSingle()
    halted = haltRow?.value === 'true'
  } catch {
    // Fail open — if we can't read the flag, proceed with loop
  }

  let loopedToNext = false
  if (!halted && finalStatus === 'completed') {
    // Check if queue is non-empty before triggering pickup
    try {
      const { count } = await db
        .from('task_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'queued')

      if ((count ?? 0) > 0) {
        void triggerPickup()
        loopedToNext = true
      }
    } catch {
      // Non-fatal — pickup will run on its own cron schedule
    }
  }

  return NextResponse.json({ ok: true, looped_to_next: loopedToNext })
}

async function triggerPickup(): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- forwarding CRON_SECRET as bearer to internal route (same pattern as notifications-drain-tick)
  const secret = process.env.CRON_SECRET
  if (!secret) return
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lepios-one.vercel.app'
  await fetch(`${base}/api/cron/task-pickup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {})
}
