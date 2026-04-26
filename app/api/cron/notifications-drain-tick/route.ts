import { NextResponse } from 'next/server'
import { GET as drainGET } from '@/app/api/harness/notifications-drain/route'

export const dynamic = 'force-dynamic'

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return request.headers.get('authorization') === `Bearer ${secret}`
}

async function tick(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  // Delegate to the actual drain — pass through authorization so the drain handler
  // can also validate (double-validation; both use the same CRON_SECRET).
  const secret = process.env.CRON_SECRET ?? ''
  const internalReq = new Request('http://internal/api/harness/notifications-drain', {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}` },
  })
  return drainGET(internalReq) as Promise<NextResponse>
}

export async function GET(request: Request): Promise<NextResponse> {
  return tick(request)
}

export async function POST(request: Request): Promise<NextResponse> {
  return tick(request)
}
