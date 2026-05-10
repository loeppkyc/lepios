// F18: bench=n8n_webhook_latency<200ms; surface=agent_events event_type=n8n_webhook
// module_metric: agent_events WHERE event_type = 'n8n_webhook'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function verifyToken(request: Request): boolean {
  const token = process.env.N8N_WEBHOOK_TOKEN
  if (!token) return false
  const provided = new URL(request.url).searchParams.get('token') ?? ''
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(provided))
}

export async function GET(request: Request): Promise<NextResponse> {
  const endpoint = new URL(request.url).searchParams.get('endpoint') ?? ''

  if (endpoint === 'health') {
    if (!verifyToken(request)) {
      return NextResponse.json({ status: 'error', error: 'Invalid or missing token' })
    }
    return NextResponse.json({ status: 'ok' })
  }

  return NextResponse.json({ status: 'error', error: 'Use POST with endpoint in body' }, { status: 405 })
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!verifyToken(request)) {
    return NextResponse.json({ status: 'error', error: 'Invalid or missing token' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { endpoint?: string; [k: string]: unknown }
  const endpoint = body.endpoint ?? new URL(request.url).searchParams.get('endpoint') ?? ''

  const db = createServiceClient()

  await db.from('agent_events').insert({
    domain: 'integrations',
    action: 'n8n_webhook',
    actor: 'n8n',
    status: 'success',
    task_type: 'webhook',
    output_summary: `n8n webhook: ${endpoint}`,
    meta: { endpoint, body },
    tags: ['n8n', 'webhook'],
  })

  if (endpoint === 'health') return NextResponse.json({ status: 'ok' })

  // Stub: log + acknowledge all endpoints — full handler wiring deferred
  return NextResponse.json({ status: 'ok', endpoint, note: 'received' })
}
