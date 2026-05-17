/**
 * POST /api/cron/mood-prompt
 *
 * Daily cron at 9am MT (0 15 * * * UTC).
 * Sends a Telegram message asking Colin to rate his energy 1-5.
 * Response handled by /api/telegram/mood-response webhook.
 *
 * Auth: requireCronSecret (F22)
 * Sprint 10 Chunk D
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const supabase = createServiceClient()

  const { data: cfg } = await supabase
    .from('harness_config')
    .select('value')
    .eq('key', 'TELEGRAM_CHAT_ID')
    .single()

  const chatId = cfg?.value ? Number(cfg.value) : undefined

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })

  const message = [
    'Good morning! How is your energy today?',
    '',
    'Reply with a number:',
    '1 = Drained',
    '2 = Low',
    '3 = Neutral',
    '4 = Good',
    '5 = Peak',
    '',
    '(Optionally add a note after the number, e.g. "4 slept well")',
  ].join('\n')

  const { error: insertErr } = await supabase.from('outbound_notifications').insert({
    channel: 'telegram',
    payload: { text: message },
    correlation_id: `mood-prompt-${today}`,
    requires_response: true,
    ...(chatId ? { chat_id: chatId } : {}),
  })

  if (insertErr) {
    console.error('[mood-prompt] insert failed:', insertErr.message)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // Drain immediately
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lepios-one.vercel.app'
    await fetch(`${base}/api/harness/notifications-drain`, { method: 'POST' })
  } catch {
    // non-blocking
  }

  await supabase.from('agent_events').insert({
    domain: 'behavioral',
    action: 'mood_prompt_sent',
    meta: { date: today },
    created_at: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, date: today, sent: true })
}
