import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 20
const MAX_ATTEMPTS = 5

interface PendingRow {
  id: string
  channel: string
  chat_id: string | null
  payload: Record<string, unknown>
  attempts: number
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return request.headers.get('authorization') === `Bearer ${secret}`
}

async function sendTelegram(
  token: string,
  chatId: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  let res: Response
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, ...payload }),
    })
  } catch {
    return { ok: false, error: 'network_error' }
  }

  if (!res.ok) {
    const body = await res.text()
    return { ok: false, error: `Telegram ${res.status}: ${body.slice(0, 200)}` }
  }

  return { ok: true }
}

async function drain(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const defaultChatId = process.env.TELEGRAM_CHAT_ID

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' },
      { status: 500 }
    )
  }

  const db = createServiceClient()

  const { data: rows, error: fetchError } = await db
    .from('outbound_notifications')
    .select('id, channel, chat_id, payload, attempts')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchError) {
    return NextResponse.json({ ok: false, error: fetchError.message }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, drained: 0, failed: 0 })
  }

  let drained = 0
  let failed = 0

  for (const row of rows as PendingRow[]) {
    if (row.channel !== 'telegram') continue

    const chatId = row.chat_id ?? defaultChatId
    if (!chatId) {
      const newAttempts = row.attempts + 1
      await db
        .from('outbound_notifications')
        .update({
          attempts: newAttempts,
          last_error: 'no chat_id and TELEGRAM_CHAT_ID not configured',
          ...(newAttempts >= MAX_ATTEMPTS ? { status: 'failed' } : {}),
        })
        .eq('id', row.id)
      failed++
      continue
    }

    const result = await sendTelegram(token, chatId, row.payload)

    if (result.ok) {
      await db
        .from('outbound_notifications')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id)
      drained++
    } else {
      const newAttempts = row.attempts + 1
      await db
        .from('outbound_notifications')
        .update({
          attempts: newAttempts,
          last_error: result.error,
          ...(newAttempts >= MAX_ATTEMPTS ? { status: 'failed' } : {}),
        })
        .eq('id', row.id)
      failed++
    }
  }

  return NextResponse.json({ ok: true, drained, failed })
}

export async function GET(request: Request): Promise<NextResponse> {
  return drain(request)
}

export async function POST(request: Request): Promise<NextResponse> {
  return drain(request)
}
