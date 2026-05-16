import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { spApiConfigured } from '@/lib/amazon/client'
import { findAsinByUpc, findAsinByKeywords, getCatalogData } from '@/lib/amazon/catalog'
import { getNewBuyBox } from '@/lib/amazon/pricing'
import { getFbaFees } from '@/lib/amazon/fees'
import { getKeepaProduct } from '@/lib/keepa/product'
import { calcProfit, calcRoi, getDecision } from '@/lib/profit/calculator'

export const dynamic = 'force-dynamic'

interface ArbScanItem {
  name: string
  retail_price: number
  upc?: string
}

interface ArbScanRequest {
  items: ArbScanItem[]
  min_roi_pct?: number
  min_profit_cad?: number
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!spApiConfigured()) {
    return NextResponse.json({ error: 'SP-API credentials not configured' }, { status: 503 })
  }

  let body: ArbScanRequest
  try {
    body = (await request.json()) as ArbScanRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const items = body.items ?? []
  if (items.length === 0 || items.length > 20) {
    return NextResponse.json({ error: 'items must be 1–20 entries' }, { status: 400 })
  }

  const scanSettings = {
    min_roi_pct: body.min_roi_pct ?? 15,
    min_profit_cad: body.min_profit_cad ?? 3.0,
    max_bsr: 0,
  }

  const startMs = Date.now()

  const results = await Promise.allSettled(
    items.map(async (item) => {
      // Step 1: ASIN lookup
      const asin = item.upc
        ? ((await findAsinByUpc(item.upc)) ?? (await findAsinByKeywords(item.name)))
        : await findAsinByKeywords(item.name)

      if (!asin) {
        return { ...item, status: 'no_match' as const }
      }

      // Step 2: buy box + keepa + catalog in parallel, then fees with the real buy box price
      const [buyBox, keepa, catalog] = await Promise.all([
        getNewBuyBox(asin),
        getKeepaProduct(asin),
        getCatalogData(asin),
      ])

      if (buyBox == null) {
        return { ...item, status: 'no_new_listing' as const, asin, title: catalog.title }
      }

      const feesVal = await getFbaFees(asin, buyBox, { bookMode: false })
      const profit = calcProfit(buyBox, feesVal, item.retail_price)
      const roi = calcRoi(profit, item.retail_price)
      const velocityMultiplier = Math.min(2, 1 + (keepa?.rankDrops30 ?? 0) / 50)
      const score = Math.round(roi * velocityMultiplier * 100) / 100
      const decision = getDecision(profit, roi, keepa?.bsr ?? catalog.bsr ?? null, scanSettings)

      return {
        name: item.name,
        retail_price: item.retail_price,
        upc: item.upc,
        status: decision,
        asin,
        title: catalog.title || item.name,
        imageUrl: catalog.imageUrl,
        buy_box_new: buyBox,
        fba_fees: feesVal,
        profit,
        roi_pct: roi,
        score,
        bsr: keepa?.bsr ?? catalog.bsr ?? null,
        keepa: keepa
          ? {
              rankDrops30: keepa.rankDrops30 ?? 0,
              monthlySold: keepa.monthlySold ?? 0,
              velocityBadge: keepa.velocityBadge,
            }
          : null,
      }
    })
  )

  const settled = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { name: items[i].name, retail_price: items[i].retail_price, status: 'no_match' as const }
  )

  const duration_ms = Date.now() - startMs
  const matched = settled.filter((r) => r.status !== 'no_match' && r.status !== 'no_new_listing')
  const bought = settled.filter((r) => r.status === 'buy')
  const roiSum = matched.reduce((s, r) => s + (('roi_pct' in r ? r.roi_pct : null) ?? 0), 0)
  const avg_roi_pct = matched.length > 0 ? Math.round((roiSum / matched.length) * 10) / 10 : 0

  // F18 metric
  const svc = createServiceClient()
  await svc.from('agent_events').insert({
    domain: 'retail',
    action: 'arb_scan',
    actor: user.id,
    duration_ms,
    meta: {
      batch_size: items.length,
      matched_count: matched.length,
      buy_count: bought.length,
      avg_roi_pct,
      items_with_upc: items.filter((i) => i.upc).length,
    },
  })

  const sorted = [...settled].sort((a, b) => {
    const sa = 'score' in a ? (a.score ?? 0) : 0
    const sb = 'score' in b ? (b.score ?? 0) : 0
    return sb - sa
  })

  return NextResponse.json({ results: sorted, scanned_at: new Date().toISOString(), duration_ms })
}
