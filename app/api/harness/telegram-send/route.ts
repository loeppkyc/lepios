import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { telegram } from '@/lib/harness/arms-legs/telegram'

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

  const chatId = parsed.data.chat_id ?? process.env.TELEGRAM_CHAT_ID
  const { text } = parsed.data

  if (!process.env.TELEGRAM_BOT_TOKEN) {
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
  const result = await telegram(text, { chatId, agentId: 'harness' })

  if (!result.ok) {
    await logEvent('error', chatIdSuffix, text.length, { error: result.error })
    const httpStatus = result.failure_type === 'network_error' ? 503 : 502
    return NextResponse.json(
      { ok: false, error: result.error, upstream_description: result.description ?? null },
      { status: httpStatus }
    )
  }

  await logEvent('success', chatIdSuffix, text.length, { message_id: result.messageId })
  return NextResponse.json({ ok: true, message_id: result.messageId })
}
