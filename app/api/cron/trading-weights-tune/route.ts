/**
 * POST /api/cron/trading-weights-tune
 *
 * Weekly cron Sunday 9pm MT (0 4 * * 1 UTC).
 * Delegates to /api/trading/learn (existing route that calls analyzeAndLearn).
 * After tune, dispatches Telegram summary.
 *
 * Auth: requireCronSecret (F22)
 * Sprint 10 Chunk A
 */

import { NextResponse } from 'next/server'
import { requireCronSecret, getCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const secret = getCronSecret()
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lepios-one.vercel.app'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${secret}`,
  }

  const supabase = createServiceClient()

  // ── Step 1: Delegate to learn route ────────────────────────────────────────
  let learnResult: Record<string, unknown> = {}
  try {
    const learnRes = await fetch(`${base}/api/trading/learn`, {
      method: 'POST',
      headers,
    })
    learnResult = (await learnRes.json()) as Record<string, unknown>
    if (!learnRes.ok) {
      console.error('[trading-weights-tune] learn step failed:', learnResult)
    }
  } catch (err) {
    console.error('[trading-weights-tune] learn step threw:', err)
    learnResult = { error: String(err) }
  }

  // ── Step 2: Dispatch Telegram summary ──────────────────────────────────────
  if (!learnResult.skipped && !learnResult.error) {
    const { data: cfg } = await supabase
      .from('harness_config')
      .select('value')
      .eq('key', 'TELEGRAM_CHAT_ID')
      .single()

    const chatId = cfg?.value ? Number(cfg.value) : undefined
    const reasoning = (learnResult.reasoning as string) ?? 'Weights auto-tuned by Claude'

    await supabase.from('outbound_notifications').insert({
      channel: 'telegram',
      payload: {
        text: `Trading Weights Tuned (Sunday)\n${reasoning}`,
      },
      correlation_id: `trading-weights-tune-${new Date().toISOString().slice(0, 10)}`,
      requires_response: false,
      ...(chatId ? { chat_id: chatId } : {}),
    })

    // Drain
    try {
      await fetch(`${base}/api/harness/notifications-drain`, { method: 'POST', headers })
    } catch {
      // non-blocking
    }
  }

  return NextResponse.json({ ok: true, learn: learnResult })
}
