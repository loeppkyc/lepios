import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { spApiConfigured } from '@/lib/amazon/client'
import { findAsin, getCatalogData } from '@/lib/amazon/catalog'
import { getUsedBuyBox } from '@/lib/amazon/pricing'
import { getFbaFees } from '@/lib/amazon/fees'
import { normalizeIsbn, isIsbn } from '@/lib/amazon/isbn'
import { calcProfit, calcRoi, getDecision } from '@/lib/profit/calculator'
import { getKeepaProduct } from '@/lib/keepa/product'
import { getEbayListings } from '@/lib/ebay/listings'
import { estimateEbayProfit } from '@/lib/ebay/fees'

const ScanBody = z.object({
  isbn: z.string().min(1),
  cost_paid: z.number().positive().max(999.99),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!spApiConfigured()) {
    return NextResponse.json({ error: 'SP-API credentials not configured' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ScanBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { isbn: rawIsbn, cost_paid: costPaid } = parsed.data
  const isbn = normalizeIsbn(rawIsbn)

  if (!isIsbn(isbn)) {
    return NextResponse.json({ error: 'ISBN must be 10 or 13 digits' }, { status: 400 })
  }

  const startMs = Date.now()

  // Step 1: ISBN → ASIN (sequential — required for all subsequent calls)
  const asin = await findAsin(isbn)

  if (!asin) {
    await supabase.from('agent_events').insert({
      domain: 'pageprofit',
      action: 'scan',
      actor: 'user',
      status: 'error',
      input_summary: `ISBN: ${isbn}, cost: $${costPaid}`,
      error_message: `No ASIN found for ISBN ${isbn}`,
      duration_ms: Date.now() - startMs,
      meta: { isbn },
    })
    return NextResponse.json(
      { error: `No Amazon CA listing found for ISBN ${isbn}` },
      { status: 404 }
    )
  }

  // Step 2: catalog + buy box in parallel (independent of each other)
  const [catalog, buyBoxPrice] = await Promise.all([getCatalogData(asin), getUsedBuyBox(asin)])

  if (!buyBoxPrice) {
    await supabase.from('agent_events').insert({
      domain: 'pageprofit',
      action: 'scan',
      actor: 'user',
      status: 'error',
      input_summary: `ISBN: ${isbn}, cost: $${costPaid}`,
      error_message: `No used buy box price for ASIN ${asin}`,
      duration_ms: Date.now() - startMs,
      meta: { isbn, asin },
    })
    return NextResponse.json(
      { error: 'No used buy-box price on Amazon CA for this book' },
      { status: 404 }
    )
  }

  // Step 3: FBA fees + Keepa + eBay in parallel (none depend on each other)
  const [fbaFees, keepaProduct, ebayResult] = await Promise.all([
    getFbaFees(asin, buyBoxPrice),
    getKeepaProduct(asin),
    getEbayListings(isbn, catalog.title || undefined),
  ])

  const profit = calcProfit(buyBoxPrice, fbaFees, costPaid)
  const roi = calcRoi(profit, costPaid)

  // eBay median is active listing prices (asking prices), not sold comps.
  // Not used as a buy/skip gate until we have real sell-through data to validate the signal.
  const decision = getDecision(profit, roi)

  // Resolve BSR + source: SP-API is preferred; Keepa fills the gap
  const bsr = catalog.bsr > 0 ? catalog.bsr : (keepaProduct?.bsr ?? null)
  const bsrSource: 'sp-api' | 'keepa' | null =
    catalog.bsr > 0 ? 'sp-api' : keepaProduct?.bsr ? 'keepa' : null

  // eBay comp fields
  const ebayListings = ebayResult.listings
  const ebayProfit = ebayListings ? estimateEbayProfit(ebayListings.medianCad, costPaid) : null

  // Write scan result
  const { error: dbError } = await supabase.from('scan_results').insert({
    // SPRINT5-GATE: replace with profiles FK + RLS policy (ARCHITECTURE.md §7.3, MN-3)
    person_handle: 'colin',
    isbn,
    asin,
    title: catalog.title || null,
    cost_paid_cad: costPaid,
    buy_box_price_cad: buyBoxPrice,
    fba_fees_cad: fbaFees,
    profit_cad: profit,
    roi_pct: roi,
    decision,
    marketplace: 'amazon_ca',
    bsr,
    bsr_source: bsrSource,
    rank_drops_30: keepaProduct?.rankDrops30 ?? null,
    monthly_sold: keepaProduct?.monthlySold ?? null,
    avg_rank_90d: keepaProduct?.avgRank90d ?? null,
    ebay_listing_median_cad: ebayListings?.medianCad ?? null,
    ebay_listing_count: ebayListings?.count ?? null,
    ebay_profit_cad: ebayProfit,
  })

  // Write agent event — non-critical, don't fail the scan if this errors
  await supabase.from('agent_events').insert({
    domain: 'pageprofit',
    action: 'scan',
    actor: 'user',
    status: dbError ? 'warning' : 'success',
    input_summary: `ISBN: ${isbn}, cost: $${costPaid}`,
    output_summary: `ASIN: ${asin}, profit: $${profit.toFixed(2)}, decision: ${decision}`,
    duration_ms: Date.now() - startMs,
    meta: {
      isbn,
      asin,
      buy_box_price_cad: buyBoxPrice,
      fba_fees_cad: fbaFees,
      profit_cad: profit,
      roi_pct: roi,
      keepa_tokens_left: keepaProduct?.tokensLeft ?? null,
      ebay_listing_count: ebayListings?.count ?? null,
      ...(ebayResult.fallbackReason ? { ebay_fallback_reason: ebayResult.fallbackReason } : {}),
    },
  })

  if (dbError) {
    return NextResponse.json({ error: 'Failed to save scan result' }, { status: 500 })
  }

  return NextResponse.json(
    {
      isbn,
      asin,
      title: catalog.title,
      imageUrl: catalog.imageUrl,
      bsr,
      bsrCategory: catalog.bsrCategory,
      bsrSource,
      buyBoxPrice,
      fbaFees,
      costPaid,
      profit,
      roi,
      decision,
      marketplace: 'amazon_ca',
      keepa: keepaProduct
        ? {
            bsr: keepaProduct.bsr,
            avgRank90d: keepaProduct.avgRank90d,
            rankDrops30: keepaProduct.rankDrops30,
            monthlySold: keepaProduct.monthlySold,
            velocityBadge: keepaProduct.velocityBadge,
          }
        : null,
      ebay: ebayListings
        ? {
            medianCad: ebayListings.medianCad,
            lowCad: ebayListings.lowCad,
            highCad: ebayListings.highCad,
            count: ebayListings.count,
            profit: ebayProfit,
            fallbackUsed: ebayListings.fallbackUsed,
          }
        : null,
    },
    { status: 201 }
  )
}
