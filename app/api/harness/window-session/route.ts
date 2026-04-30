import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { startWindowSession, heartbeatWindow, endWindowSession } from '@/lib/harness/window-tracker'

export const dynamic = 'force-dynamic'

type ActionBody =
  | {
      action: 'start'
      session_id: string
      initial_task?: string
      metadata?: Record<string, unknown>
    }
  | { action: 'heartbeat'; session_id: string; current_task: string }
  | { action: 'end'; session_id: string }

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: ActionBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const { action, session_id } = body as { action?: string; session_id?: string }

  if (!session_id || typeof session_id !== 'string' || session_id.trim() === '') {
    return NextResponse.json({ ok: false, error: 'session_id is required' }, { status: 400 })
  }

  if (!action || !['start', 'heartbeat', 'end'].includes(action)) {
    return NextResponse.json(
      { ok: false, error: 'action must be one of: start, heartbeat, end' },
      { status: 400 }
    )
  }

  try {
    if (action === 'start') {
      const { initial_task, metadata } = body as {
        action: 'start'
        session_id: string
        initial_task?: string
        metadata?: Record<string, unknown>
      }
      await startWindowSession(session_id, initial_task, metadata)
    } else if (action === 'heartbeat') {
      const { current_task } = body as {
        action: 'heartbeat'
        session_id: string
        current_task: string
      }
      if (!current_task || typeof current_task !== 'string') {
        return NextResponse.json(
          { ok: false, error: 'current_task is required for heartbeat' },
          { status: 400 }
        )
      }
      await heartbeatWindow(session_id, current_task)
    } else {
      await endWindowSession(session_id)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
