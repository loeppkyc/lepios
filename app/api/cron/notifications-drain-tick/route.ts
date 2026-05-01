import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { GET as drainGET } from '@/app/api/harness/notifications-drain/route'

export const dynamic = 'force-dynamic'

async function tick(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized
  // Delegate to the actual drain — pass through authorization so the drain handler
  // can also validate (double-validation; both use the same CRON_SECRET).
  // eslint-disable-next-line no-restricted-syntax -- forwarding bearer to internal handler, not auth validation
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
