import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// POST /api/coordinator/fire
// Inserts a task into task_queue with source='api' and immediately triggers pickup.
// F22-compliant: requireCronSecret enforces CRON_SECRET bearer auth.
//
// Body: { task: string, priority?: number, metadata?: Record<string, unknown> }
// Returns: { ok: true, task_id: string } | { ok: false, error: string }

export async function POST(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: { task?: unknown; priority?: unknown; metadata?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const task = typeof body.task === 'string' ? body.task.trim() : ''
  if (!task) {
    return NextResponse.json({ ok: false, error: 'task is required' }, { status: 400 })
  }

  const priority =
    typeof body.priority === 'number' && body.priority >= 1 && body.priority <= 10
      ? body.priority
      : 5

  const metadata =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {}

  const db = createServiceClient()

  // Insert into task_queue
  const { data, error } = await db
    .from('task_queue')
    .insert({
      task,
      priority,
      source: 'api',
      metadata: { ...metadata, fired_via: 'coordinator_fire_endpoint' },
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'insert failed' },
      { status: 500 }
    )
  }

  const taskId = data.id as string

  // Kick pickup non-blocking — best-effort; task is already in queue even if this fails
  void triggerPickup()

  return NextResponse.json({ ok: true, task_id: taskId })
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
