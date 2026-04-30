import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: { task_id?: unknown; run_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const { task_id, run_id } = body

  if (!task_id || typeof task_id !== 'string' || !isValidUUID(task_id)) {
    return NextResponse.json(
      { ok: false, error: 'task_id is required and must be a valid UUID' },
      { status: 400 }
    )
  }

  const db = createServiceClient()

  try {
    const { data, error } = await db
      .from('task_queue')
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq('id', task_id)
      .eq('status', 'claimed')
      .select('id')

    if (error) {
      return NextResponse.json({ ok: false, error: error.message })
    }

    const updated = Array.isArray(data) ? data : []

    if (updated.length === 0) {
      return NextResponse.json({ ok: false, error: 'task not found or not claimed' })
    }

    // Log success to agent_events (fire-and-forget, swallow errors)
    try {
      await db.from('agent_events').insert({
        id: crypto.randomUUID(),
        domain: 'orchestrator',
        action: 'task_heartbeat',
        actor: 'coordinator',
        status: 'success',
        task_type: 'task_heartbeat',
        output_summary: `heartbeat for task ${task_id}`,
        meta: {
          task_id,
          ...(run_id !== undefined ? { run_id } : {}),
        },
        tags: ['heartbeat', 'harness'],
      })
    } catch {
      // Non-fatal — heartbeat itself succeeded
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: msg })
  }
}
