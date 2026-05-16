import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

interface ArbDecisionBody {
  scan_result_id?: string | null
  asin: string
  isbn?: string | null
  title?: string | null
  decision: 'buy' | 'skip' | 'unsure'
  confidence_pct?: number | null
  cost_paid_cad?: number | null
  buy_box_price_cad?: number | null
  profit_cad?: number | null
  roi_pct?: number | null
  bsr?: number | null
  tier?: string | null
  notes?: string | null
}

export async function POST(request: Request) {
  // User-facing route — standard session auth (not cron-secret)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: ArbDecisionBody
  try {
    body = (await request.json()) as ArbDecisionBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.asin) {
    return NextResponse.json({ error: 'asin is required' }, { status: 400 })
  }
  const validDecisions = ['buy', 'skip', 'unsure'] as const
  if (!validDecisions.includes(body.decision as (typeof validDecisions)[number])) {
    return NextResponse.json(
      { error: 'decision must be buy, skip, or unsure' },
      { status: 400 }
    )
  }

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('arb_decisions')
    .insert({
      scan_result_id: body.scan_result_id ?? null,
      asin: body.asin,
      isbn: body.isbn ?? null,
      title: body.title ?? null,
      decision: body.decision,
      confidence_pct: body.confidence_pct ?? null,
      cost_paid_cad: body.cost_paid_cad ?? null,
      buy_box_price_cad: body.buy_box_price_cad ?? null,
      profit_cad: body.profit_cad ?? null,
      roi_pct: body.roi_pct ?? null,
      bsr: body.bsr ?? null,
      tier: body.tier ?? null,
      notes: body.notes ?? null,
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ id: data.id }, { status: 201 })
}
