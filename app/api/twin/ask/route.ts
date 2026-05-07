import { NextRequest, NextResponse } from 'next/server'
import { askTwin, type TwinResponse } from '@/lib/twin/query'
import { requireUser } from '@/lib/auth/require-user'
import { hasValidCronSecret } from '@/lib/auth/cron-secret'

// Re-export types that external consumers (tests, client code) import from this module.
export type { TwinSource, TwinResponse, EscalateReason } from '@/lib/twin/query'

export async function POST(
  req: NextRequest
): Promise<NextResponse<TwinResponse | { error: string }>> {
  // Twin Q&A is called by (a) the admin UI/dev tools and (b) coordinator agents
  // running with a Bearer CRON_SECRET. Accept either.
  if (!hasValidCronSecret(req)) {
    const gate = await requireUser({ minRole: 'admin' })
    if (!gate.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: gate.response.status })
    }
  }

  const body = (await req.json()) as { question?: string; context?: string; chunk_id?: string }
  const question = (body.question ?? '').trim()

  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 })
  }

  const resp = await askTwin(question)
  return NextResponse.json<TwinResponse>(resp)
}
