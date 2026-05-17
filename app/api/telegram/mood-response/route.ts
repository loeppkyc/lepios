/**
 * POST /api/telegram/mood-response
 *
 * Telegram webhook handler for mood prompt replies.
 * Called when Colin replies to the mood prompt with "1"-"5".
 * Optionally accepts a note after the number, e.g. "4 slept well".
 *
 * Auth: TELEGRAM_WEBHOOK_SECRET header (same pattern as main webhook)
 * Sprint 10 Chunk D
 *
 * This is a separate lightweight webhook — not wired to the main
 * /api/telegram/webhook to avoid coupling. The bot must be configured
 * to send mood replies here, OR the main webhook must forward them.
 * For v1: standalone endpoint; the main webhook can forward via Telegram
 * message routing logic in a later sprint.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

interface TgMessage {
  message_id: number
  chat: { id: number }
  from?: { id: number; username?: string }
  text?: string
}

interface TelegramUpdate {
  update_id: number
  message?: TgMessage
}

function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return false
  return request.headers.get('x-telegram-bot-api-secret-token') === secret
}

/**
 * Parse a mood reply string.
 * Valid patterns: "3", "4 slept well", "5 great day"
 * Returns null if the message doesn't start with 1-5.
 */
function parseMoodReply(text: string): { energy: number; notes: string | null } | null {
  const match = text.trim().match(/^([1-5])(.*)?$/)
  if (!match) return null
  const energy = parseInt(match[1], 10)
  const notes = match[2]?.trim() || null
  return { energy, notes }
}

export async function POST(request: Request) {
  // Verify webhook secret
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const message = update.message
  if (!message?.text) {
    // Not a text message — acknowledge and ignore
    return NextResponse.json({ ok: true, skipped: true })
  }

  const parsed = parseMoodReply(message.text)
  if (!parsed) {
    // Doesn't match mood pattern — not for us
    return NextResponse.json({ ok: true, skipped: true, reason: 'Not a mood reply' })
  }

  const supabase = createServiceClient()

  const { error: insertErr } = await supabase.from('mood_log').insert({
    logged_at: new Date().toISOString(),
    energy: parsed.energy,
    notes: parsed.notes,
    source: 'telegram',
  })

  if (insertErr) {
    console.error('[mood-response] insert failed:', insertErr.message)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // Acknowledge via agent_events
  await supabase.from('agent_events').insert({
    domain: 'behavioral',
    action: 'mood_logged',
    meta: { energy: parsed.energy, has_notes: parsed.notes != null, source: 'telegram' },
    created_at: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, energy: parsed.energy })
}
