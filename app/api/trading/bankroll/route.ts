/**
 * GET /api/trading/bankroll
 *
 * Returns BankrollSummary computed from bets.bankroll_after history.
 *
 * Auth: requires active session.
 */

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'
import { computeBankrollSummary } from '@/lib/trading/bankroll'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const db = createServiceClient()

  // SPRINT5-GATE: person_handle hardcoded
  const { data: bets, error } = await db
    .from('bets')
    .select('bet_date, bankroll_after, pnl')
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .not('bankroll_after', 'is', null)
    .order('bet_date', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const summary = computeBankrollSummary(bets ?? [])
  return NextResponse.json(summary)
}
