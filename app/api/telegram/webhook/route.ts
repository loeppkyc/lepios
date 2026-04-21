import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isAllowedUser, parseCallbackData } from '@/lib/harness/telegram-buttons'

export const dynamic = 'force-dynamic'

type CallbackQuery = {
  id: string
  from: { id: number; username?: string }
  message: { message_id: number; chat: { id: number } }
  data?: string
}

type TelegramUpdate = {
  update_id: number
  callback_query?: CallbackQuery
}

function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return false
  return request.headers.get('x-telegram-bot-api-secret-token') === secret
}

async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  }).catch(() => {})
}

async function logWebhookEvent(
  agentEventId: string | null,
  fromUserId: number,
  callbackData: string,
  status: 'success' | 'warning'
): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'telegram_callback',
      actor: 'telegram_webhook',
      status,
      task_type: 'telegram_callback',
      output_summary: `callback from user ${fromUserId}: ${callbackData}`,
      meta: { agent_event_id: agentEventId, from_user_id: fromUserId, callback_data: callbackData },
      tags: ['telegram', 'webhook', 'component2'],
    })
  } catch {
    // Swallow — webhook still returns 200
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const { callback_query: callbackQuery } = update

  if (!callbackQuery) {
    return NextResponse.json({ ok: true })
  }

  if (!isAllowedUser(callbackQuery.from.id)) {
    await answerCallbackQuery(callbackQuery.id)
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const parsed = parseCallbackData(callbackQuery.data ?? '')

  // Skeleton: log receipt and acknowledge — task_feedback write added next session
  void logWebhookEvent(
    parsed?.agentEventId ?? null,
    callbackQuery.from.id,
    callbackQuery.data ?? '',
    parsed ? 'success' : 'warning'
  )
  await answerCallbackQuery(callbackQuery.id)

  return NextResponse.json({ ok: true })
}
