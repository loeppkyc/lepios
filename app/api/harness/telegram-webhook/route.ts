import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// ── Types ─────────────────────────────────────────────────────────────────────

type TgUser = { id: number; username?: string; first_name?: string }

type TgMessage = {
  message_id: number
  chat: { id: number }
  from?: TgUser
  text?: string
  reply_to_message?: { message_id: number }
}

type TgCallbackQuery = {
  id: string
  from: TgUser
  message: TgMessage
  data?: string
}

type TelegramUpdate = {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return false
  return request.headers.get('x-telegram-bot-api-secret-token') === secret
}

// ── Telegram ──────────────────────────────────────────────────────────────────

async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  }).catch(() => {})
}

// ── Correlation ───────────────────────────────────────────────────────────────

// Finds the outbound_notifications row to correlate this inbound update against.
// Three strategies tried in order; returns the matched row id or null.
//
// Strategy B (reply-to match) requires the drain route to store the Telegram
// message_id in payload->>'message_id' after a successful send. Until that is
// wired, B silently falls through to C.
async function findMatchingRow(
  db: ReturnType<typeof createServiceClient>,
  update: TelegramUpdate,
  chatId: number
): Promise<string | null> {
  // A: callback_query whose data is JSON containing {correlation_id: "..."}
  const rawCallbackData = update.callback_query?.data
  if (rawCallbackData) {
    try {
      const parsed = JSON.parse(rawCallbackData) as Record<string, unknown>
      if (typeof parsed.correlation_id === 'string') {
        const { data } = await db
          .from('outbound_notifications')
          .select('id')
          .eq('correlation_id', parsed.correlation_id)
          .eq('requires_response', true)
          .eq('status', 'sent')
          .maybeSingle()
        if (data) return (data as { id: string }).id
      }
    } catch {
      // Not JSON or no correlation_id — fall through
    }
  }

  // B: text reply with reply_to_message — match by Telegram message_id
  //    stored in payload->>'message_id' by the drain after a successful send
  const replyToId = update.message?.reply_to_message?.message_id
  if (replyToId != null) {
    const { data } = await db
      .from('outbound_notifications')
      .select('id')
      .eq('requires_response', true)
      .eq('status', 'sent')
      .eq('chat_id', String(chatId))
      .filter('payload->>message_id', 'eq', String(replyToId))
      .maybeSingle()
    if (data) return (data as { id: string }).id
  }

  // C: fallback — most recent sent+requires_response row for this chat in last 24h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await db
    .from('outbound_notifications')
    .select('id')
    .eq('requires_response', true)
    .eq('status', 'sent')
    .eq('chat_id', String(chatId))
    .is('response_received_at', null)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data) return (data as { id: string }).id

  return null
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return NextResponse.json({ ok: true }) // always 200 — Telegram retries on non-200
  }

  const { message, callback_query: callbackQuery } = update

  // Ack callback immediately — spinner stays open until we do, Telegram expects it within seconds
  if (callbackQuery) {
    void answerCallbackQuery(callbackQuery.id)
  }

  if (!message && !callbackQuery) {
    return NextResponse.json({ ok: true }) // other update types (edited_message, etc.) — ignore
  }

  const chatId: number | null = callbackQuery?.message.chat.id ?? message?.chat.id ?? null
  const fromUser: TgUser | null = callbackQuery?.from ?? message?.from ?? null

  if (chatId == null) {
    return NextResponse.json({ ok: true })
  }

  const db = createServiceClient()
  const matchedId = await findMatchingRow(db, update, chatId)

  if (!matchedId) {
    try {
      await db.from('agent_events').insert({
        domain: 'telegram',
        action: 'webhook_no_match',
        actor: 'harness',
        status: 'warning',
        task_type: 'webhook_no_match',
        output_summary: `inbound update ${update.update_id} — no outbound_notifications match`,
        meta: {
          update_id: update.update_id,
          chat_id: chatId,
          is_callback: Boolean(callbackQuery),
          callback_data: callbackQuery?.data ?? null,
          has_reply_to: Boolean(message?.reply_to_message),
          text_preview: message?.text?.slice(0, 100) ?? null,
        },
      })
    } catch {
      // Logging failure is non-fatal — always return 200 to Telegram
    }
    return NextResponse.json({ ok: true })
  }

  const isCallback = Boolean(callbackQuery)
  const responsePayload = {
    type: isCallback ? 'callback' : 'message',
    text: message?.text ?? null,
    callback_data: callbackQuery?.data ?? null,
    from_user: fromUser
      ? `${fromUser.id}${fromUser.username ? ` (@${fromUser.username})` : ''}`
      : null,
    raw_update_id: String(update.update_id),
  }

  await db
    .from('outbound_notifications')
    .update({
      response: responsePayload,
      response_received_at: new Date().toISOString(),
      status: 'response_received',
    })
    .eq('id', matchedId)

  return NextResponse.json({ ok: true })
}
