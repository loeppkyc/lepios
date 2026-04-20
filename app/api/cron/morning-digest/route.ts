import { NextResponse } from 'next/server'
import { sendMorningDigest } from '@/lib/orchestrator/digest'

export const dynamic = 'force-dynamic'

const CRON_SECRET = process.env.CRON_SECRET

function isAuthorized(request: Request): boolean {
  if (!CRON_SECRET) return true
  return request.headers.get('authorization') === `Bearer ${CRON_SECRET}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const status = await sendMorningDigest()
    return NextResponse.json({ ok: true, status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
