import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
  const data = await res.json()
  return NextResponse.json(data)
}
