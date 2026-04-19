import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { spApiConfigured } from '@/lib/amazon/client'
import { findAsin, getCatalogData } from '@/lib/amazon/catalog'
import { getUsedBuyBox } from '@/lib/amazon/pricing'
import { getFbaFees } from '@/lib/amazon/fees'
import { normalizeIsbn, isIsbn } from '@/lib/amazon/isbn'
import { calcProfit, calcRoi, getDecision } from '@/lib/profit/calculator'

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

  // Step 2: catalog data + buy box in parallel (independent of each other)
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

  // Step 3: FBA fees — depends on buy box price, so sequential after step 2
  const fbaFees = await getFbaFees(asin, buyBoxPrice)

  const profit = calcProfit(buyBoxPrice, fbaFees, costPaid)
  const roi = calcRoi(profit, costPaid)
  const decision = getDecision(profit, roi)

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
      bsr: catalog.bsr,
      bsrCategory: catalog.bsrCategory,
      buyBoxPrice,
      fbaFees,
      costPaid,
      profit,
      roi,
      decision,
      marketplace: 'amazon_ca',
    },
    { status: 201 }
  )
}
