import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { runPickup } from '@/lib/harness/pickup-runner'

export const dynamic = 'force-dynamic'

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // dev: no secret configured
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.TASK_PICKUP_ENABLED) {
    return NextResponse.json({ ok: false, reason: 'task-pickup-disabled', duration_ms: 0 })
  }

  try {
    const runId = crypto.randomUUID()
    const result = await Promise.race([
      runPickup(runId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('task pickup exceeded 60s timeout')), 60_000)
      ),
    ])
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
