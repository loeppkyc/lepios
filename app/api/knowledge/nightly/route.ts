import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { nightlyLearn } from '@/lib/knowledge/patterns'

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const result = await nightlyLearn()

  return NextResponse.json({
    ok: true,
    ...result,
  })
}

// Allow Vercel Cron to call this as GET (cron jobs use GET by default)
export async function GET(request: Request) {
  return POST(request)
}
