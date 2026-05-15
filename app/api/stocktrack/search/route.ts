import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchProduct, STOCKTRACK_STORES } from '@/lib/retail/stocktrack-client'

export const dynamic = 'force-dynamic'

// GET /api/stocktrack/search?store={code}&q={query}&type={search|upc|sku}
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const store = searchParams.get('store') ?? ''
  const query = searchParams.get('q') ?? ''
  const type = (searchParams.get('type') ?? 'search') as 'search' | 'upc' | 'sku'

  if (!store || !STOCKTRACK_STORES[store]) {
    return NextResponse.json(
      { error: `store required; valid: ${Object.keys(STOCKTRACK_STORES).join(', ')}` },
      { status: 400 }
    )
  }
  if (!query) {
    return NextResponse.json({ error: 'q required' }, { status: 400 })
  }

  try {
    const products = await searchProduct(store, query, type)
    return NextResponse.json({ products, store, store_name: STOCKTRACK_STORES[store] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'StockTrack unreachable'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
