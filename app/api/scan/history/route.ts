import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)

  const rawDecision = searchParams.get('decision') ?? 'all'
  const decision = ['buy', 'skip', 'all'].includes(rawDecision) ? rawDecision : 'all'

  const rawLimit = parseInt(searchParams.get('limit') ?? '100', 10)
  const limit = isNaN(rawLimit) || rawLimit < 1 ? 100 : Math.min(rawLimit, 100)

  // SPRINT5-GATE: replace person_handle literal with auth.uid() → profiles lookup
  let query = supabase
    .from('scan_results')
    .select(
      'id, isbn, asin, title, buy_box_price_cad, profit_cad, roi_pct, decision, cost_paid_cad, bsr, tier, recorded_at'
    )
    .eq('person_handle', 'colin') // SPRINT5-GATE: replace with auth

  if (decision !== 'all') {
    query = query.eq('decision', decision)
  }

  const { data, error } = await query.order('recorded_at', { ascending: false }).limit(limit)

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch scan history' }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
