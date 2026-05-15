import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { scanForDeals, STOCKTRACK_STORES } from '@/lib/retail/stocktrack-client'
import { logEvent } from '@/lib/knowledge/client'
import type { StockTrackPeriod } from '@/lib/retail/stocktrack-client'
import type { PriceDrop } from '@/lib/retail/types'

export const dynamic = 'force-dynamic'

// POST /api/stocktrack/scan
// Body: { store_codes: string[], min_discount_pct?: number, period?: string, keywords?: string, send_telegram?: boolean }
// Runs multi-store price-drop scan. Persists results to stocktrack_results.
// When send_telegram=true and deals found: inserts outbound_notifications row.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const rawCodes = body.store_codes
  if (!Array.isArray(rawCodes) || rawCodes.length === 0) {
    return NextResponse.json({ error: 'store_codes must be a non-empty array' }, { status: 400 })
  }

  const storeCodes = rawCodes.filter(
    (c): c is string => typeof c === 'string' && Boolean(STOCKTRACK_STORES[c])
  )
  if (storeCodes.length === 0) {
    return NextResponse.json(
      { error: `No valid store codes. Valid: ${Object.keys(STOCKTRACK_STORES).join(', ')}` },
      { status: 400 }
    )
  }

  const minDiscountPct = Math.max(0, Number(body.min_discount_pct ?? 30))
  const period = (body.period ?? 'today') as StockTrackPeriod
  const keywords = typeof body.keywords === 'string' ? body.keywords || undefined : undefined
  const sendTelegram = Boolean(body.send_telegram)

  const t0 = Date.now()
  const deals: PriceDrop[] = await scanForDeals(storeCodes, minDiscountPct, period, keywords)
  const durationMs = Date.now() - t0

  const db = createServiceClient()

  // Persist to cache
  if (deals.length > 0) {
    await db.from('stocktrack_results').insert(
      deals.map((d) => ({
        store_code: d.store_code,
        query: `scan:${period}`,
        product_name: d.product_name,
        sku: d.sku || null,
        current_price: d.current_price,
        regular_price: d.regular_price,
        discount_pct: d.discount_pct,
        in_stock: false,
      }))
    )
  }

  // Telegram notification (via outbound_notifications — F18 pattern)
  if (sendTelegram && deals.length > 0) {
    const lines = deals.slice(0, 20).map(
      (d) =>
        `• ${d.product_name} (${STOCKTRACK_STORES[d.store_code] ?? d.store_code}): ` +
        `$${(d.current_price ?? 0).toFixed(2)} ` +
        `(was $${(d.regular_price ?? 0).toFixed(2)}, ` +
        `${(d.discount_pct ?? 0).toFixed(0)}% off)`
    )
    const text =
      `🛒 StockTrack Auto Scan — ${storeCodes.map((c) => STOCKTRACK_STORES[c] ?? c).join(', ')}\n` +
      `${deals.length} deal${deals.length !== 1 ? 's' : ''} ≥${minDiscountPct}% off (${period})\n\n` +
      lines.join('\n') +
      (deals.length > 20 ? `\n…and ${deals.length - 20} more` : '')

    await db.from('outbound_notifications').insert({
      channel: 'telegram',
      payload: { text },
      correlation_id: `stocktrack_scan_${Date.now()}`,
    })
  }

  // F18 observability
  await logEvent('retail', 'stocktrack_scan', {
    status: 'success',
    durationMs,
    meta: {
      store_codes: storeCodes,
      results_count: deals.length,
      period,
      min_discount_pct: minDiscountPct,
    },
  })

  return NextResponse.json({
    deals,
    stores_scanned: storeCodes.length,
    deals_found: deals.length,
    duration_ms: durationMs,
  })
}
