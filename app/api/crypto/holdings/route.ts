import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('crypto_holdings')
    .select('*')
    .order('symbol', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ holdings: data ?? [] })
}

export async function POST(request: Request) {
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

  const { symbol, name, quantity, avg_cost_cad, wallet_or_exchange, notes } = body as Record<
    string,
    unknown
  >

  if (!symbol || typeof symbol !== 'string')
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  if (typeof quantity !== 'number' || isNaN(quantity))
    return NextResponse.json({ error: 'quantity must be a number' }, { status: 400 })

  const { data, error } = await supabase
    .from('crypto_holdings')
    .insert({
      user_id: user.id,
      symbol: symbol.trim().toUpperCase(),
      name: typeof name === 'string' && name ? name.trim() : null,
      quantity,
      avg_cost_cad: typeof avg_cost_cad === 'number' ? avg_cost_cad : null,
      wallet_or_exchange:
        typeof wallet_or_exchange === 'string' && wallet_or_exchange
          ? wallet_or_exchange.trim()
          : null,
      notes: typeof notes === 'string' && notes ? notes.trim() : null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ holding: data }, { status: 201 })
}
