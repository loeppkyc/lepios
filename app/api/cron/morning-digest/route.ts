import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { sendMorningDigest } from '@/lib/orchestrator/digest'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

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
