import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkAvailability, STOCKTRACK_STORES, EDMONTON_STORE_IDS } from '@/lib/retail/stocktrack-client'

export const dynamic = 'force-dynamic'

// GET /api/stocktrack/availability?store={code}&sku={sku}
// Returns Edmonton-area stock availability for a given SKU.
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const store = searchParams.get('store') ?? ''
  const sku = searchParams.get('sku') ?? ''

  if (!store || !STOCKTRACK_STORES[store]) {
    return NextResponse.json(
      { error: `store required; valid: ${Object.keys(STOCKTRACK_STORES).join(', ')}` },
      { status: 400 }
    )
  }
  if (!sku) {
    return NextResponse.json({ error: 'sku required' }, { status: 400 })
  }

  try {
    const stores = await checkAvailability(store, sku)
    const inStock = stores.filter((s) => s.quantity > 0).length
    return NextResponse.json({
      stores,
      store_ids_checked: EDMONTON_STORE_IDS[store] ?? [],
      in_stock_count: inStock,
      total_checked: stores.length,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'StockTrack unreachable'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
