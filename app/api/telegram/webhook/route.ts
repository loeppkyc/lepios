import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isAllowedUser, parseCallbackData } from '@/lib/harness/telegram-buttons'

export const dynamic = 'force-dynamic'

type CallbackQuery = {
  id: string
  from: { id: number; username?: string }
  message: { message_id: number; chat: { id: number }; text?: string }
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

// Upsert: update if a tap already exists for this (agent_event_id, source) pair,
// insert otherwise. Latest tap wins — allows 👍 → 👎 correction.
async function writeFeedback(params: {
  agentEventId: string
  feedbackType: 'thumbs_up' | 'thumbs_down'
  source: string
  fromUserId: number
  messageId: number
  callbackQueryId: string
}): Promise<void> {
  const { agentEventId, feedbackType, source, fromUserId, messageId, callbackQueryId } = params
  const meta = {
    telegram_user_id: fromUserId,
    message_id: messageId,
    callback_query_id: callbackQueryId,
  }

  try {
    const db = createServiceClient()

    const { data: existing } = await db
      .from('task_feedback')
      .select('id')
      .eq('agent_event_id', agentEventId)
      .eq('source', source)
      .maybeSingle()

    if (existing) {
      await db
        .from('task_feedback')
        .update({ feedback_type: feedbackType, created_at: new Date().toISOString(), meta })
        .eq('id', (existing as { id: string }).id)
    } else {
      await db
        .from('task_feedback')
        .insert({ agent_event_id: agentEventId, feedback_type: feedbackType, source, meta })
    }
  } catch {
    // Swallow — answerCallbackQuery and edit still proceed
  }
}

// Removes the inline keyboard and appends "👍 recorded at HH:MM MT" to the message.
// Fire-and-forget; edit failure is non-fatal.
async function editMessageWithAck(
  chatId: number,
  messageId: number,
  originalText: string,
  action: 'up' | 'dn'
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return

  const emoji = action === 'up' ? '👍' : '👎'
  const timestamp = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: `${originalText}\n${emoji} recorded at ${timestamp} MT`,
      reply_markup: { inline_keyboard: [] },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram editMessageText error ${res.status}: ${body}`)
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

  void logWebhookEvent(
    parsed?.agentEventId ?? null,
    callbackQuery.from.id,
    callbackQuery.data ?? '',
    parsed ? 'success' : 'warning'
  )

  if (parsed) {
    await writeFeedback({
      agentEventId: parsed.agentEventId,
      feedbackType: parsed.action === 'up' ? 'thumbs_up' : 'thumbs_down',
      source: 'telegram_pickup_button',
      fromUserId: callbackQuery.from.id,
      messageId: callbackQuery.message.message_id,
      callbackQueryId: callbackQuery.id,
    })
  }

  // Dismiss spinner before the edit — answerCallbackQuery must fire first
  await answerCallbackQuery(callbackQuery.id)

  if (parsed) {
    try {
      await editMessageWithAck(
        callbackQuery.message.chat.id,
        callbackQuery.message.message_id,
        callbackQuery.message.text ?? '',
        parsed.action
      )
    } catch (err) {
      // Don't throw — callback is already acked, feedback row is written.
      try {
        const db = createServiceClient()
        await db.from('agent_events').insert({
          domain: 'orchestrator',
          action: 'telegram_edit',
          actor: 'telegram_webhook',
          status: 'error',
          task_type: 'telegram_edit_fail',
          output_summary: `Failed to edit message ${callbackQuery.message.message_id} after ${parsed.action}`,
          meta: {
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id,
            action: parsed.action,
            error: String(err),
          },
          tags: ['telegram', 'webhook', 'component2'],
        })
      } catch {
        // logEvent itself failed — swallow, we already acked.
      }
    }
  }

  return NextResponse.json({ ok: true })
}
