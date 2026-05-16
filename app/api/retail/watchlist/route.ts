import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'
import type { RetailWatchlistCreate } from '@/lib/retail/types'

export async function GET() {
  const db = createServiceClient()
  const { data, error } = await db
    .from('retail_watchlist')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data })
}

export async function POST(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const body = (await request.json()) as RetailWatchlistCreate

  if (!body.product?.trim()) {
    return NextResponse.json({ error: 'product is required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('retail_watchlist')
    .insert({
      product: body.product.trim(),
      brand: body.brand?.trim() ?? null,
      category: body.category ?? null,
      upc: body.upc?.trim() ?? null,
      asin: body.asin?.trim() ?? null,
      store: body.store ?? 'Unknown',
      buy_price: body.buy_price ?? null,
      regular_price: body.regular_price ?? null,
      pct_off: body.pct_off ?? null,
      amazon_price: body.amazon_price ?? null,
      est_fba_fees: body.est_fba_fees ?? null,
      est_profit: body.est_profit ?? null,
      roi_pct: body.roi_pct ?? null,
      target_buy_price: body.target_buy_price ?? null,
      current_price: body.current_price ?? null,
      url: body.url?.trim() ?? null,
      status: body.status ?? 'watching',
      notes: body.notes?.trim() ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // F18 observability — log watchlist_add so conversion metrics can be tracked
  await db.from('agent_events').insert({
    domain: 'retail',
    action: 'watchlist_add',
    status: 'success',
    output_summary: `Added "${body.product.trim()}" from ${body.store ?? 'Unknown'} to watchlist`,
    metadata: {
      product: body.product.trim(),
      store: body.store ?? 'Unknown',
      buy_price: body.buy_price ?? null,
      pct_off: body.pct_off ?? null,
      watchlist_id: data?.id ?? null,
    },
  })

  return NextResponse.json({ id: data?.id, item: data }, { status: 201 })
}
