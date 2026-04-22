// TODO: DELETE THIS FILE after diagnosis — short-lived diagnostic route
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return NextResponse.json({ ok: false, error: 'no_token' })

  const [infoRes, meRes] = await Promise.all([
    fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`),
    fetch(`https://api.telegram.org/bot${token}/getMe`),
  ])
  const info = await infoRes.json()
  const me = await meRes.json()
  return NextResponse.json({ ok: true, webhook_info: info, me })
}
