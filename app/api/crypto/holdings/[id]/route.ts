import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { id } = await params
  const { symbol, name, quantity, avg_cost_cad, wallet_or_exchange, notes } = body as Record<
    string,
    unknown
  >

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof symbol === 'string') update.symbol = symbol.trim().toUpperCase()
  if (name !== undefined) update.name = typeof name === 'string' && name ? name.trim() : null
  if (typeof quantity === 'number') update.quantity = quantity
  if (avg_cost_cad !== undefined)
    update.avg_cost_cad = typeof avg_cost_cad === 'number' ? avg_cost_cad : null
  if (wallet_or_exchange !== undefined)
    update.wallet_or_exchange =
      typeof wallet_or_exchange === 'string' && wallet_or_exchange
        ? wallet_or_exchange.trim()
        : null
  if (notes !== undefined) update.notes = typeof notes === 'string' && notes ? notes.trim() : null

  const { data, error } = await supabase
    .from('crypto_holdings')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ holding: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { error } = await supabase.from('crypto_holdings').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
