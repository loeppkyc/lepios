/**
 * lib/keepa/lightning.ts
 *
 * Fetches active lightning deals (and Best Deals) from Keepa for a given domain.
 *
 * Keepa deal endpoint: GET https://api.keepa.com/deal?key=<KEY>&selection=<JSON>
 * Cost: ~50 tokens per call (flat, not per-ASIN).
 *
 * Selection shape: { domainId, deltaPercentRange: [min, -1], priceTypes: 0, page, perPage, isFilterEnabled }
 * Response shape: { deals: { dr: KeepaRawDeal[] }, tokensLeft: number }
 *
 * Price units in Keepa: integer values in hundredths of the currency unit.
 *   -1 = no offer / unavailable.
 *   2999 = $29.99
 *
 * Timestamps in Keepa deal responses: minutes since epoch (Unix ms ÷ 60 000).
 */

import { keepaConfigured } from './client'

const KEEPA_BASE = 'https://api.keepa.com'

function keepaKey(): string {
  return process.env.KEEPA_API_KEY ?? ''
}

export interface LightningDeal {
  asin: string
  title: string | null
  /** CAD (or domain currency), already divided by 100 */
  dealPrice: number | null
  /** CAD (or domain currency), already divided by 100 */
  origPrice: number | null
  discountPct: number | null
  dealType: 'lightning' | 'best'
  startsAt: Date | null
  endsAt: Date | null
}

interface KeepaLightningSelection {
  domainId: number
  deltaPercentRange: [number, number] // [minPct, -1] — -1 means no upper bound
  priceTypes: number
  page: number
  perPage: number
  isFilterEnabled: boolean
}

interface KeepaRawDeal {
  asin?: string
  title?: string
  // Keepa deal fields can be scalar ints or price-history arrays — treat as unknown
  dealPrice?: unknown
  currentPrice?: unknown
  deltaPercent?: unknown
  isLightningDeal?: boolean
  lightningStart?: unknown
  lightningEnd?: unknown
}

interface KeepaDealsResponse {
  deals?: { dr?: KeepaRawDeal[] } | null
  tokensLeft?: number
}

/**
 * Fetch active lightning deals for a domain.
 * Returns deals sorted by discount % descending.
 * Costs ~50 tokens per call — do not call more than once per cron tick.
 *
 * @param domain  - Keepa domain ID (6 = Amazon.ca)
 * @param minDiscountPct - Minimum discount percentage to include (default 20)
 * @param limit   - Max deals to return per page (default 50, Keepa max 100)
 */
export async function getLightningDeals(
  domain = 6,
  minDiscountPct = 20,
  limit = 50
): Promise<{ deals: LightningDeal[]; tokensLeft: number | null }> {
  if (!keepaConfigured()) return { deals: [], tokensLeft: null }

  const apiKey = keepaKey()

  const selection: KeepaLightningSelection = {
    domainId: domain,
    deltaPercentRange: [minDiscountPct, -1], // -1 = no upper bound on discount
    priceTypes: 0, // 0 = Amazon price
    page: 0,
    perPage: limit,
    isFilterEnabled: true,
  }

  const url = `${KEEPA_BASE}/deal?key=${apiKey}&selection=${encodeURIComponent(JSON.stringify(selection))}`

  let json: KeepaDealsResponse
  try {
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) {
      console.error(`[lightning] Keepa deal endpoint ${res.status}`)
      return { deals: [], tokensLeft: null }
    }
    json = (await res.json()) as KeepaDealsResponse
  } catch (e) {
    console.error('[lightning] fetch error:', e)
    return { deals: [], tokensLeft: null }
  }

  const tokensLeft: number | null = json.tokensLeft ?? null
  const rawDeals: KeepaRawDeal[] = json.deals?.dr ?? []

  const deals: LightningDeal[] = rawDeals
    .map((d) => ({
      asin: d.asin ?? '',
      title: d.title ?? null,
      // Keepa price units: integer hundredths → divide by 100.
      // Guard: some Keepa deal fields are price-history arrays — only use if scalar > 0.
      dealPrice: typeof d.dealPrice === 'number' && d.dealPrice > 0 ? d.dealPrice / 100 : null,
      origPrice:
        typeof d.currentPrice === 'number' && d.currentPrice > 0 ? d.currentPrice / 100 : null,
      discountPct: typeof d.deltaPercent === 'number' ? d.deltaPercent : null,
      dealType: d.isLightningDeal ? ('lightning' as const) : ('best' as const),
      // Keepa timestamps: minutes since Unix epoch → multiply by 60 000 for ms.
      // lightningStart/End = 0 means "no value" in Keepa — guard against epoch date.
      startsAt:
        typeof d.lightningStart === 'number' && d.lightningStart > 0
          ? new Date(d.lightningStart * 60_000)
          : null,
      endsAt:
        typeof d.lightningEnd === 'number' && d.lightningEnd > 0
          ? new Date(d.lightningEnd * 60_000)
          : null,
    }))
    .filter((d) => d.asin.length > 0)

  // Sort by discount descending
  deals.sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0))

  return { deals, tokensLeft }
}
