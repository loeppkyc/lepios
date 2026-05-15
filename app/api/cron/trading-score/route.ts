/**
 * POST /api/cron/trading-score
 *
 * Thin cron wrapper:
 *   1. Calls /api/trading/score (scores 14 instruments, upserts predictions)
 *   2. Calls /api/trading/learn (weight auto-tune if >= 20 completed predictions)
 *
 * Schedule: 0 13 * * * (7:00 AM MDT = 13:00 UTC)
 *
 * Auth: requireCronSecret (F22)
 */

import { NextResponse } from 'next/server'
import { requireCronSecret, getCronSecret } from '@/lib/auth/cron-secret'

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

  const results: Record<string, unknown> = {}

  // ── Step 1: Score ───────────────────────────────────────────────────────────
  try {
    const scoreRes = await fetch(`${base}/api/trading/score`, {
      method: 'POST',
      headers,
    })
    const scoreData = (await scoreRes.json()) as unknown
    results.score = scoreData
    if (!scoreRes.ok) {
      console.error('[cron/trading-score] score step failed:', scoreData)
    }
  } catch (err) {
    console.error('[cron/trading-score] score step threw:', err)
    results.score = { error: String(err) }
  }

  // ── Step 2: Learn (if enough data) ─────────────────────────────────────────
  try {
    const learnRes = await fetch(`${base}/api/trading/learn`, {
      method: 'POST',
      headers,
    })
    const learnData = (await learnRes.json()) as unknown
    results.learn = learnData
  } catch (err) {
    console.error('[cron/trading-score] learn step threw:', err)
    results.learn = { error: String(err) }
  }

  return NextResponse.json({ ok: true, results })
}
