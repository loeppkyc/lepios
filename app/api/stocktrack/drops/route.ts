import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getPriceDrops, STOCKTRACK_STORES } from '@/lib/retail/stocktrack-client'
import type { StockTrackPeriod } from '@/lib/retail/stocktrack-client'

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours

// GET /api/stocktrack/drops?store={code}&period={today|yesterday|weekly}&min_pct={n}&search={q}
// Cache-first: returns stocktrack_results rows within TTL, fetches fresh if stale.
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const store = searchParams.get('store') ?? ''
  const period = (searchParams.get('period') ?? 'today') as StockTrackPeriod
  const minPct = Math.max(0, Number(searchParams.get('min_pct') ?? '0'))
  const search = searchParams.get('search') ?? undefined

  if (!store || !STOCKTRACK_STORES[store]) {
    return NextResponse.json(
      { error: `store required; valid: ${Object.keys(STOCKTRACK_STORES).join(', ')}` },
      { status: 400 }
    )
  }

  const db = createServiceClient()
  const query = search ?? `drops:${period}`
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString()

  // Check cache: same store + query string within 4h
  const { data: cached } = await db
    .from('stocktrack_results')
    .select('*')
    .eq('store_code', store)
    .eq('query', query)
    .gte('scanned_at', cutoff)
    .order('scanned_at', { ascending: false })
    .limit(100)

  if (cached && cached.length > 0) {
    const filtered =
      minPct > 0 ? cached.filter((r) => r.discount_pct != null && r.discount_pct >= minPct) : cached
    return NextResponse.json({ drops: filtered, store, cached: true })
  }

  // Cache miss — fetch fresh from StockTrack
  let drops
  try {
    drops = await getPriceDrops(store, { period, minDiscountPct: 0, search })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'StockTrack unreachable'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  if (drops.length > 0) {
    await db.from('stocktrack_results').insert(
      drops.map((d) => ({
        store_code: store,
        query,
        product_name: d.product_name,
        sku: d.sku || null,
        current_price: d.current_price,
        regular_price: d.regular_price,
        discount_pct: d.discount_pct,
        in_stock: false,
      }))
    )
  }

  const filtered = minPct > 0 ? drops.filter((d) => d.discount_pct != null && d.discount_pct >= minPct) : drops
  return NextResponse.json({ drops: filtered, store, cached: false })
}
