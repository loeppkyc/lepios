import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const RouteBody = z.object({
  routing_decision: z.enum(['go', 'bbv', 'donate']),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: scanResultId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = RouteBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'routing_decision must be go | bbv | donate' },
      { status: 400 }
    )
  }

  const { routing_decision } = parsed.data
  const service = createServiceClient()

  // Fetch the scan result to get fields needed for bbv_outbox
  const { data: scanRow, error: fetchError } = await service
    .from('scan_results')
    .select('id, isbn, asin, title, author, tier, cost_paid_cad, buy_box_price_cad')
    .eq('id', scanResultId)
    .single()

  if (fetchError || !scanRow) {
    return NextResponse.json({ error: 'Scan result not found' }, { status: 404 })
  }

  // Update routing decision
  const { error: updateError } = await service
    .from('scan_results')
    .update({ routing_decision })
    .eq('id', scanResultId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Write to bbv_outbox if routing to BBV
  if (routing_decision === 'bbv' && scanRow.tier) {
    await service.from('bbv_outbox').insert({
      scan_result_id: scanResultId,
      isbn: scanRow.isbn,
      asin: scanRow.asin,
      title: scanRow.title,
      author: scanRow.author,
      tier: scanRow.tier,
      cost_paid_cad: scanRow.cost_paid_cad,
      buy_box_price_cad: scanRow.buy_box_price_cad,
    })
  }

  await service.from('agent_events').insert({
    domain: 'pageprofit',
    action: 'scan_routed',
    actor: 'user',
    status: 'success',
    meta: { scan_result_id: scanResultId, routing_decision, tier: scanRow.tier },
  })

  return NextResponse.json({ ok: true })
}
