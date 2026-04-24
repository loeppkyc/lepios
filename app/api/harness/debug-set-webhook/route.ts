import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!token) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }
  if (!webhookSecret) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_WEBHOOK_SECRET not set' }, { status: 500 })
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://lepios-one.vercel.app/api/telegram/webhook',
      secret_token: webhookSecret,
      allowed_updates: ['message', 'callback_query'],
    }),
  })
  const data = await res.json()
  return NextResponse.json(data)
}
