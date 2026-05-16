// F18: bench=0 auto-approved tasks escalated to Colin; surface=/api/harness/auto-approve-docs (agent_events)
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { runAutoApprove } from '@/lib/harness/auto-approve'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const authError = requireCronSecret(request)
  if (authError) return authError

  try {
    const result = await runAutoApprove()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
