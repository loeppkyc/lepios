import { NextResponse } from 'next/server'
import { nightlyLearn } from '@/lib/knowledge/patterns'

// Security: require CRON_SECRET header to prevent unauthenticated triggers.
// Set CRON_SECRET in .env.local. Telegram bot sends it when calling this endpoint.
// Vercel Cron jobs send it automatically if configured in vercel.json.
const CRON_SECRET = process.env.CRON_SECRET

export async function POST(request: Request) {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

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
