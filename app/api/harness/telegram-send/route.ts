import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const SendSchema = z.object({
  text: z
    .string()
    .min(1, 'text must be non-empty')
    .max(4096, 'text exceeds Telegram 4096-char limit'),
  chat_id: z.string().optional(),
})

async function logEvent(
  status: 'success' | 'error',
  chatIdSuffix: string,
  textLength: number,
  extra: Record<string, unknown>
): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      id: crypto.randomUUID(),
      domain: 'orchestrator',
      action: 'telegram_send',
      actor: 'harness',
      status,
      task_type: 'telegram_send',
      output_summary:
        status === 'success'
          ? `Sent ${textLength}-char message to ...${chatIdSuffix}`
          : `Failed to send to ...${chatIdSuffix}`,
      meta: { chat_id_suffix: chatIdSuffix, text_length: textLength, ...extra },
    })
  } catch {
    // Logging failure is non-fatal
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SendSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const defaultChatId = process.env.TELEGRAM_CHAT_ID
  const chatId = parsed.data.chat_id ?? defaultChatId
  const { text } = parsed.data

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' },
      { status: 500 }
    )
  }
  if (!chatId) {
    return NextResponse.json(
      { ok: false, error: 'chat_id must be provided or TELEGRAM_CHAT_ID must be set' },
      { status: 500 }
    )
  }

  const chatIdSuffix = chatId.slice(-4)
  const url = `https://api.telegram.org/bot${token}/sendMessage`

  let tgRes: Response
  try {
    tgRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  } catch (err) {
    await logEvent('error', chatIdSuffix, text.length, { error: 'network_error' })
    return NextResponse.json(
      { ok: false, error: 'Network error reaching Telegram API' },
      { status: 503 }
    )
  }

  const tgBody = (await tgRes.json()) as {
    ok: boolean
    result?: { message_id: number }
    description?: string
  }

  if (!tgRes.ok) {
    const description = tgBody.description ?? `HTTP ${tgRes.status}`
    await logEvent('error', chatIdSuffix, text.length, { error: description })
    return NextResponse.json(
      { ok: false, error: 'Telegram API error', upstream_description: description },
      { status: 502 }
    )
  }

  const messageId = tgBody.result?.message_id
  await logEvent('success', chatIdSuffix, text.length, { message_id: messageId })
  return NextResponse.json({ ok: true, message_id: messageId })
}
