import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'
import { STOCKTRACK_STORES } from '@/lib/retail/stocktrack-client'

export const dynamic = 'force-dynamic'

// GET /api/stocktrack/results?days=7&store=bb&min_discount=0&limit=100
export async function GET(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const days = Math.max(1, Math.min(90, Number(searchParams.get('days') ?? '7')))
  const store = searchParams.get('store') ?? ''
  const minDiscount = Math.max(0, Number(searchParams.get('min_discount') ?? '0'))
  const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') ?? '100')))

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const db = createServiceClient()

  let query = db
    .from('stocktrack_results')
    .select(
      'id, store_code, product_name, sku, current_price, regular_price, discount_pct, in_stock, scanned_at'
    )
    .gte('scanned_at', cutoff)
    .order('scanned_at', { ascending: false })
    .limit(limit)

  if (store && STOCKTRACK_STORES[store]) {
    query = query.eq('store_code', store)
  }

  if (minDiscount > 0) {
    query = query.gte('discount_pct', minDiscount)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = (data ?? []).map((row) => ({
    ...row,
    store_label: STOCKTRACK_STORES[row.store_code] ?? row.store_code,
  }))

  // Aggregate metadata
  const storesPresent = [...new Set(results.map((r) => r.store_code))]
  const latestScanAt = results.length > 0 ? results[0].scanned_at : null

  return NextResponse.json({
    results,
    total: results.length,
    stores_present: storesPresent,
    latest_scan_at: latestScanAt,
  })
}
