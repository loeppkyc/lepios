import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { fireCoordinator } from '@/lib/harness/invoke-coordinator'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const InvokeSchema = z.object({
  task_id: z.string().regex(UUID_RE, 'task_id must be a valid UUID'),
  run_id: z.string().min(1, 'run_id must be non-empty'),
})

export async function POST(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = InvokeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const result = await fireCoordinator(parsed.data)

  if (!result.ok) {
    let status: number
    if (result.failure_type === 'missing_env') {
      status = 500
    } else if (result.failure_type === 'upstream' && result.upstream_status === 429) {
      status = 429
    } else {
      status = 503
    }
    return NextResponse.json({ ok: false, error: result.error }, { status })
  }

  return NextResponse.json({
    ok: true,
    session_id: result.session_id,
    session_url: result.session_url,
  })
}
