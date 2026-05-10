import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { PolymarketPrediction } from '@/lib/polymarket/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('polymarket_predictions')
    .select('*')
    .eq('user_id', user.id)
    .order('trade_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ predictions: data ?? [] })
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as Partial<PolymarketPrediction>
  const { trade_date, market, pick, buy_price, confidence, potential_return, notes } = body

  if (!market || !pick) {
    return NextResponse.json({ error: 'market and pick required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('polymarket_predictions')
    .insert({
      user_id: user.id,
      trade_date: trade_date ?? new Date().toISOString().slice(0, 10),
      market,
      pick,
      buy_price: buy_price ?? null,
      confidence: confidence ?? null,
      potential_return: potential_return ?? null,
      notes: notes ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ prediction: data })
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { id: string; resolved: boolean; outcome?: string; pnl?: number }
  const { id, resolved, outcome, pnl } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase
    .from('polymarket_predictions')
    .update({ resolved, outcome: outcome ?? null, pnl: pnl ?? null })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
