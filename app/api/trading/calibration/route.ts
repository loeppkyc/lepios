/**
 * GET /api/trading/calibration
 *
 * Returns CalibrationBucket[] computed from settled bets with win_prob_pct.
 *
 * Query params:
 *   from: YYYY-MM-DD  (optional)
 *   to:   YYYY-MM-DD  (optional)
 *
 * Auth: requires active session (user route, not cron).
 */

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'
import { computeCalibration } from '@/lib/trading/calibration'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const db = createServiceClient()

  // SPRINT5-GATE: person_handle hardcoded
  let query = db
    .from('bets')
    .select('win_prob_pct, result')
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .in('result', ['win', 'loss'])
    .not('win_prob_pct', 'is', null)

  if (from) query = query.gte('bet_date', from)
  if (to) query = query.lte('bet_date', to)

  const { data: bets, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const buckets = computeCalibration(bets ?? [])
  return NextResponse.json(buckets)
}
