/**
 * POST /api/cron/trading-picks-scan
 *
 * Daily cron at 7am MT weekdays (0 13 * * 1-5 UTC).
 * Thin orchestration wrapper:
 *   1. Delegates scoring to /api/trading/score (existing route)
 *   2. Dispatches Telegram notification with today's picks via outbound_notifications
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
  const today = new Date().toISOString().slice(0, 10)

  // ── Step 1: Score instruments via existing route ────────────────────────────
  let scoreResult: Record<string, unknown> = {}
  try {
    const scoreRes = await fetch(`${base}/api/trading/score`, {
      method: 'POST',
      headers,
    })
    scoreResult = (await scoreRes.json()) as Record<string, unknown>
    if (!scoreRes.ok) {
      console.error('[trading-picks-scan] score step failed:', scoreResult)
    }
  } catch (err) {
    console.error('[trading-picks-scan] score step threw:', err)
    scoreResult = { error: String(err) }
  }

  // ── Step 2: Load today's picks for Telegram message ────────────────────────
  const { data: picks } = await supabase
    .from('predictions')
    .select(
      'ticker, direction, grade, confidence, entry_price, stop_price, target_price, risk_reward, reason'
    )
    .eq('domain', 'trading')
    .eq('pick_date', today)
    .order('weighted_score', { ascending: false })
    .limit(10)

  // ── Step 3: Dispatch Telegram via outbound_notifications ───────────────────
  if (picks && picks.length > 0) {
    const { data: cfg } = await supabase
      .from('harness_config')
      .select('value')
      .eq('key', 'TELEGRAM_CHAT_ID')
      .single()

    const chatId = cfg?.value ? Number(cfg.value) : undefined

    const gradeLines = picks.map((p) => {
      const dir = p.direction === 'long' ? 'LONG' : 'SHORT'
      const rr = p.risk_reward != null ? ` R:R ${Number(p.risk_reward).toFixed(1)}` : ''
      return `${p.grade} ${p.ticker} ${dir} @ ${Number(p.entry_price).toFixed(2)}${rr}`
    })

    const message = [
      `Trading Picks — ${today}`,
      `${picks.length} pick${picks.length === 1 ? '' : 's'} generated`,
      '',
      ...gradeLines,
    ].join('\n')

    await supabase.from('outbound_notifications').insert({
      channel: 'telegram',
      payload: { text: message },
      correlation_id: `trading-picks-${today}`,
      requires_response: false,
      ...(chatId ? { chat_id: chatId } : {}),
    })
  }

  // ── Log to agent_events ─────────────────────────────────────────────────────
  await supabase.from('agent_events').insert({
    domain: 'trading',
    action: 'trading_picks_scan',
    meta: {
      date: today,
      picks_count: picks?.length ?? 0,
      score_result: scoreResult,
    },
    created_at: new Date().toISOString(),
  })

  // ── Drain notifications ─────────────────────────────────────────────────────
  try {
    await fetch(`${base}/api/harness/notifications-drain`, {
      method: 'POST',
      headers,
    })
  } catch {
    // non-blocking
  }

  return NextResponse.json({
    ok: true,
    date: today,
    picks: picks?.length ?? 0,
    score: scoreResult,
  })
}
