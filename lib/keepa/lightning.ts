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
 * Timestamps in Keepa deal responses: minutes since 2011-01-01 00:00:00 UTC (Keepa epoch).
 *   Keepa epoch in Unix ms = 1_293_840_000_000.
 *   Convert: new Date(keepaMinutes * 60_000 + KEEPA_EPOCH_MS)
 *
 * Price fields in deal objects can be returned as price-history arrays
 * [keepaTime1, value1, keepaTime2, value2, ...] rather than scalars.
 * Use keepaScalarOrLast() to extract the most recent valid value from either format.
 */

import { keepaConfigured } from './client'

const KEEPA_BASE = 'https://api.keepa.com'
// Keepa epoch: 2011-01-01 00:00:00 UTC in Unix milliseconds
const KEEPA_EPOCH_MS = 1_293_840_000_000

function keepaKey(): string {
  return process.env.KEEPA_API_KEY ?? ''
}

/**
 * Extract a valid positive value from a Keepa field that may be either:
 * - A plain integer (hundredths of currency, or a percentage)
 * - A price-history array: [keepaTime, value, keepaTime, value, ...]
 * Returns the last positive value found, or null.
 */
function keepaScalarOrLast(val: unknown): number | null {
  if (typeof val === 'number') return val > 0 ? val : null
  if (!Array.isArray(val) || val.length === 0) return null
  // Price history arrays alternate [timestamp, price, timestamp, price, ...].
  // Scan backwards — odd indices (1, 3, 5...) are the price/value slots.
  for (let i = val.length - 1; i >= 1; i -= 2) {
    const v = val[i]
    if (typeof v === 'number' && v > 0) return v
  }
  return null
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
  type?: number // 0 = best deal, 1 = lightning deal
  dealPrice?: unknown // scalar int or price-history array
  currentPrice?: unknown // scalar int or price-history array
  deltaPercent?: unknown // scalar int or price-history array
  lightningStart?: unknown // Keepa time (minutes since 2011-01-01)
  lightningEnd?: unknown // Keepa time (minutes since 2011-01-01)
  salesRanks?: Record<string, number> // category_id → BSR
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
 * @param minDiscountPct - Minimum discount percentage to include (default 25)
 * @param limit   - Max deals to return per page (default 50, Keepa max 100)
 */
export async function getLightningDeals(
  domain = 6,
  minDiscountPct = 25,
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

  if (rawDeals.length > 0) {
    const d0 = rawDeals[0] as Record<string, unknown>
    console.log('[keepa-deal-debug]', JSON.stringify({
      keys: Object.keys(d0),
      type: d0['type'],
      dealPrice: d0['dealPrice'],
      currentPrice: d0['currentPrice'],
      deltaPercent: d0['deltaPercent'],
      lightningStart: d0['lightningStart'],
      lightningEnd: d0['lightningEnd'],
      asin: d0['asin'],
    }))
  }

  const deals: LightningDeal[] = rawDeals
    .map((d) => {
      // Price fields: may be scalar or price-history array — extract last valid value
      const rawDeal = keepaScalarOrLast(d.dealPrice)
      const rawOrig = keepaScalarOrLast(d.currentPrice)
      const rawDiscount = keepaScalarOrLast(d.deltaPercent)

      // Convert Keepa time (minutes since 2011-01-01) to Date
      const toDate = (val: unknown): Date | null => {
        const mins = typeof val === 'number' ? val : null
        if (!mins || mins <= 0) return null
        return new Date(mins * 60_000 + KEEPA_EPOCH_MS)
      }

      return {
        asin: d.asin ?? '',
        title: d.title ?? null,
        dealPrice: rawDeal != null ? rawDeal / 100 : null,
        origPrice: rawOrig != null ? rawOrig / 100 : null,
        discountPct: rawDiscount,
        dealType: d.type === 1 ? ('lightning' as const) : ('best' as const),
        startsAt: toDate(d.lightningStart),
        endsAt: toDate(d.lightningEnd),
      }
    })
    .filter((d) => d.asin.length > 0)

  // Sort by discount descending
  deals.sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0))

  return { deals, tokensLeft }
}
