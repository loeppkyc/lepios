import { keepaConfigured } from './client'

const KEEPA_BASE = 'https://api.keepa.com'

function keepaKey(): string {
  return process.env.KEEPA_API_KEY ?? ''
}

// Canadian Amazon category node IDs
export const CA_CATEGORIES: Record<string, number> = {
  Books: 927726,
  'Toys & Games': 963136,
  Electronics: 667823051,
  'Video Games': 963124,
  'Sports & Outdoors': 3371694011,
  'Tools & Home': 3000849011,
  Clothing: 2422877011,
  Baby: 2425487011,
}

export const US_CATEGORIES: Record<string, number> = {
  Books: 283155,
  'Toys & Games': 165793011,
  Electronics: 172282,
  'Video Games': 468642,
}

export interface KeepaDeal {
  asin: string
  title: string
  currentPriceCad: number
  avg90dPriceCad: number
  discountPct: number
  bsr: number
  category: string
  domain: number
}

interface RawProduct {
  asin: string
  title?: string
  monthlySold?: number
  stats?: {
    current?: number[]
    avg?: number[]
  }
}

interface KeepaApiResponse {
  products?: RawProduct[]
  tokensLeft?: number
}

interface BestSellersResponse {
  bestSellersList?: Array<{ asinList: string[] }>
}

// Keepa price units: integer hundredths of the currency (2999 = $29.99). -1 = unavailable.
function keepaPriceToCAD(units: number | undefined | null): number | null {
  if (units == null || units < 0) return null
  return units / 100
}

export async function getBestSellerAsins(
  categoryId: number,
  domain: number,
  limit: number
): Promise<string[]> {
  const key = keepaKey()
  if (!key) return []

  try {
    const url = new URL(`${KEEPA_BASE}/bestsellers`)
    url.searchParams.set('key', key)
    url.searchParams.set('domain', String(domain))
    url.searchParams.set('category', String(categoryId))
    const res = await fetch(url.toString())
    if (!res.ok) return []
    const data = (await res.json()) as BestSellersResponse
    return (data.bestSellersList?.[0]?.asinList ?? []).slice(0, limit)
  } catch {
    return []
  }
}

async function batchFetchProducts(asins: string[], domain: number): Promise<RawProduct[]> {
  const key = keepaKey()
  if (!key || asins.length === 0) return []

  try {
    const url = new URL(`${KEEPA_BASE}/product`)
    url.searchParams.set('key', key)
    url.searchParams.set('domain', String(domain))
    url.searchParams.set('asin', asins.join(','))
    // stats=90 only — never history=1 (F7: token exhaustion risk)
    url.searchParams.set('stats', '90')
    const res = await fetch(url.toString())
    if (!res.ok) return []
    const data = (await res.json()) as KeepaApiResponse
    return data.products ?? []
  } catch {
    return []
  }
}

export async function scanCategoryDeals(opts: {
  categoryId: number
  categoryName: string
  domain: number
  minDiscountPct: number
  maxBsr: number
  limit: number
}): Promise<KeepaDeal[]> {
  if (!keepaConfigured()) return []

  const asins = await getBestSellerAsins(opts.categoryId, opts.domain, opts.limit)
  if (asins.length === 0) return []

  const CHUNK = 20
  const allProducts: RawProduct[] = []
  for (let i = 0; i < asins.length; i += CHUNK) {
    const batch = await batchFetchProducts(asins.slice(i, i + CHUNK), opts.domain)
    allProducts.push(...batch)
  }

  const deals: KeepaDeal[] = []
  for (const p of allProducts) {
    const current = keepaPriceToCAD(p.stats?.current?.[0])
    const avg90d = keepaPriceToCAD(p.stats?.avg?.[0])
    const bsr = p.stats?.current?.[3] ?? 0

    if (!current || !avg90d || current <= 0 || avg90d <= 0) continue
    if (opts.maxBsr > 0 && bsr > opts.maxBsr) continue

    const discountPct = ((avg90d - current) / avg90d) * 100
    if (discountPct < opts.minDiscountPct) continue

    deals.push({
      asin: p.asin,
      title: p.title ?? p.asin,
      currentPriceCad: Math.round(current * 100) / 100,
      avg90dPriceCad: Math.round(avg90d * 100) / 100,
      discountPct: Math.round(discountPct * 10) / 10,
      bsr,
      category: opts.categoryName,
      domain: opts.domain,
    })
  }

  return deals.sort((a, b) => b.discountPct - a.discountPct)
}

export async function lookupAlertPrice(
  asin: string,
  domain: number
): Promise<{ price: number | null; bsr: number | null; tokensLeft: number | null }> {
  const products = await batchFetchProducts([asin], domain)
  const p = products[0]
  if (!p) return { price: null, bsr: null, tokensLeft: null }

  return {
    price: keepaPriceToCAD(p.stats?.current?.[0]),
    bsr: p.stats?.current?.[3] ?? null,
    tokensLeft: null,
  }
}
