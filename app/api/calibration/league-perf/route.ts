/**
 * GET /api/calibration/league-perf
 *
 * Returns league-by-league performance for sports domain.
 * Used by the calibration page league mini-table.
 *
 * Auth: Supabase session (F-N5)
 * Sprint 10 Chunk C
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLeaguePerformance } from '@/lib/calibration-metrics/metrics'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const leagues = await getLeaguePerformance()
    return NextResponse.json({ leagues })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
