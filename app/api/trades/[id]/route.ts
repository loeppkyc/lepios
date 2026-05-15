/**
 * PATCH /api/trades/[id]  — settle a trade (authenticated)
 *
 * Computes:
 *   points_pnl  = (price_out - price_in) * direction_sign
 *   dollar_pnl  = points_pnl * point_value * position_size
 *   r_multiple  = dollar_pnl / abs_risk_dollars
 *
 * Auth: session (Supabase auth cookie)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { getPointValue } from '@/lib/trading/types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const TradeSettleSchema = z.object({
  date_out: z.string().regex(DATE_RE, 'Must be YYYY-MM-DD'),
  price_out: z.number().positive(),
  stopped_out: z.boolean(),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = TradeSettleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Fetch the trade to get entry price, direction, ticker, position_size, stop_loss
  const { data: trade, error: fetchError } = await supabase
    .from('trades')
    .select('id, ticker, direction, price_in, stop_loss, position_size, mode')
    .eq('id', id)
    .single()

  if (fetchError || !trade) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  }

  const d = parsed.data
  const pointValue = getPointValue(trade.ticker)
  const positionSize = trade.position_size ?? 1
  const directionSign = trade.direction === 'long' ? 1 : -1

  const points_pnl = (d.price_out - trade.price_in) * directionSign
  const dollar_pnl = points_pnl * pointValue * positionSize

  // R-multiple: actual return / planned risk per contract
  const abs_planned_risk = Math.abs(trade.price_in - trade.stop_loss)
  const abs_planned_risk_dollars = abs_planned_risk * pointValue * positionSize
  const r_multiple = abs_planned_risk_dollars > 0 ? dollar_pnl / abs_planned_risk_dollars : null

  const { data: updated, error: updateError } = await supabase
    .from('trades')
    .update({
      date_out: d.date_out,
      price_out: d.price_out,
      stopped_out: d.stopped_out,
      points_pnl: parseFloat(points_pnl.toFixed(4)),
      dollar_pnl: parseFloat(dollar_pnl.toFixed(2)),
      r_multiple: r_multiple != null ? parseFloat(r_multiple.toFixed(4)) : null,
    })
    .eq('id', id)
    .select()
    .single()

  if (updateError) {
    console.error('[PATCH /api/trades/[id]]', updateError)
    return NextResponse.json(
      { error: 'Database error', detail: updateError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ trade: updated })
}
