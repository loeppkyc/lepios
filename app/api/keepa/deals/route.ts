import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { scanCategoryDeals, CA_CATEGORIES, US_CATEGORIES } from '@/lib/keepa/deals'
import { keepaConfigured } from '@/lib/keepa/client'
import { logEvent, logError } from '@/lib/knowledge/client'

export const dynamic = 'force-dynamic'

// GET — browse saved deals from keepa_deals table
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const limit = Math.min(Number(searchParams.get('limit') ?? '100'), 500)

  let query = supabase
    .from('keepa_deals')
    .select('*')
    .order('saved_at', { ascending: false })
    .limit(limit)

  if (category) query = query.eq('category', category)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Failed to fetch deals' }, { status: 500 })

  return NextResponse.json(data ?? [])
}

// POST — run a live category scan and optionally save results
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!keepaConfigured()) {
    return NextResponse.json({ error: 'KEEPA_API_KEY not configured' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    category = 'Books',
    domain = 6,
    minDiscountPct = 20,
    maxBsr = 500000,
    limit = 50,
    save = false,
  } = body as Record<string, unknown>

  const categories = domain === 6 ? CA_CATEGORIES : US_CATEGORIES
  const categoryId = categories[category as string]
  if (!categoryId) {
    return NextResponse.json({ error: `Unknown category: ${category}` }, { status: 400 })
  }

  const deals = await scanCategoryDeals({
    categoryId,
    categoryName: category as string,
    domain: Number(domain),
    minDiscountPct: Number(minDiscountPct),
    maxBsr: Number(maxBsr),
    limit: Math.min(Number(limit), 100),
  })

  if (save && deals.length > 0) {
    const rows = deals.map((d) => ({
      asin: d.asin,
      title: d.title,
      category: d.category,
      current_price_cad: d.currentPriceCad,
      avg_90d_price_cad: d.avg90dPriceCad,
      discount_pct: d.discountPct,
      bsr: d.bsr,
      domain: d.domain,
    }))
    const { error } = await supabase.from('keepa_deals').insert(rows)
    if (error) {
      void logError('keepa', 'deals.save', new Error(error.message), { actor: 'user' })
    } else {
      void logEvent('keepa', 'deals.scan', {
        actor: 'user',
        status: 'success',
        outputSummary: `Saved ${deals.length} deals — category: ${category}`,
      })
    }
  }

  return NextResponse.json({ deals, count: deals.length })
}
