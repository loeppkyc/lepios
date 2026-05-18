/**
 * lib/keepa/lightning.ts
 *
 * Fetches active lightning deals (and Best Deals) from Keepa for a given domain.
 *
 * Keepa deal endpoint: GET https://api.keepa.com/deal?key=<KEY>&selection=<JSON>
 * Cost: ~50 tokens per call (flat, not per-ASIN).
 *
 * Selection shape: { domainId, deltaPercentRange: [-100, -minPct], priceTypes, page, perPage, isFilterEnabled }
 *   deltaPercentRange: negative values for discounts — [-100, -25] means 25-100% below reference price.
 *
 * Response shape: { deals: { dr: KeepaRawDeal[] }, tokensLeft: number }
 *
 * Actual deal object fields (verified via API probe 2026-05-18):
 *   asin, title                — string identifiers
 *   current: number[36]        — current price per Keepa price type (hundredths); -1=unavail, -2=no data
 *     [0] = Amazon price, [1] = Marketplace new
 *   avg: number[144]           — 4 intervals × 36 types: 30d/90d/180d/365d averages
 *     avg[0..35] = 30d avgs, avg[36..71] = 90d avgs, avg[72..107] = 180d, avg[108..143] = 365d
 *   delta: number[144]         — same shape as avg; absolute price deltas
 *   deltaPercent: number[144]  — same shape; % change per interval+type (NOT used for discount — computed from current vs avg)
 *   lightningStart: number     — Keepa time (mins since 2011-01-01); 0 if not a lightning deal
 *   lightningEnd: number       — Keepa time; 0 if not a lightning deal
 *   rootCat: number            — root category ID
 *
 * Keepa epoch: 2011-01-01 00:00:00 UTC = 1_293_840_000_000 ms
 *   Convert: new Date(keepaMinutes * 60_000 + KEEPA_EPOCH_MS)
 */

import { keepaConfigured } from './client'

const KEEPA_BASE = 'https://api.keepa.com'
// Keepa epoch: 2011-01-01 00:00:00 UTC in Unix milliseconds
const KEEPA_EPOCH_MS = 1_293_840_000_000

// Keepa price-type indices in the current/avg/delta arrays
const PRICE_TYPE_AMAZON = 0
const PRICE_TYPE_MARKETPLACE_NEW = 1

function keepaKey(): string {
  return process.env.KEEPA_API_KEY ?? ''
}

/** Return positive price in hundredths, or null if -1/-2/missing. */
function validPrice(val: number | undefined): number | null {
  return val != null && val > 0 ? val : null
}

/**
 * Extract the best current price from the deal object.
 * Prefers Amazon (index 0), falls back to Marketplace new (index 1).
 * Returns value in hundredths of currency (e.g. 8360 = $83.60).
 */
function extractCurrentPrice(current: number[] | undefined): number | null {
  if (!Array.isArray(current)) return null
  return validPrice(current[PRICE_TYPE_AMAZON]) ?? validPrice(current[PRICE_TYPE_MARKETPLACE_NEW]) ?? null
}

/**
 * Extract the reference (average) price for discount computation.
 * Tries 30d avg first, then 90d avg.
 * avg[i] = 30d for price type i; avg[36+i] = 90d for price type i.
 * Returns value in hundredths of currency.
 */
function extractAvgPrice(avg: number[] | undefined, priceTypeIdx: number): number | null {
  if (!Array.isArray(avg)) return null
  return (
    validPrice(avg[priceTypeIdx]) ??
    validPrice(avg[36 + priceTypeIdx]) ??
    null
  )
}

/**
 * Determine which price type index the current price came from.
 * Returns PRICE_TYPE_AMAZON (0) if Amazon price is valid, else PRICE_TYPE_MARKETPLACE_NEW (1).
 */
function currentPriceTypeIdx(current: number[] | undefined): number {
  if (Array.isArray(current) && validPrice(current[PRICE_TYPE_AMAZON]) != null) {
    return PRICE_TYPE_AMAZON
  }
  return PRICE_TYPE_MARKETPLACE_NEW
}

export interface LightningDeal {
  asin: string
  title: string | null
  /** CAD (or domain currency), already divided by 100 */
  dealPrice: number | null
  /** 30d or 90d average price for the same price type, already divided by 100 */
  origPrice: number | null
  /** Computed from (origPrice - dealPrice) / origPrice * 100 — positive = discount */
  discountPct: number | null
  dealType: 'lightning' | 'best'
  startsAt: Date | null
  endsAt: Date | null
}

interface KeepaRawDeal {
  asin?: string
  title?: string
  current?: number[]      // 36 elements — current price per price type
  avg?: number[]          // 144 elements — 4 intervals × 36 types
  delta?: number[]        // same shape as avg
  deltaPercent?: number[] // same shape as avg
  lightningStart?: number // Keepa time (0 if not a lightning deal)
  lightningEnd?: number   // Keepa time (0 if not a lightning deal)
  rootCat?: number
}

interface KeepaDealsResponse {
  deals?: { dr?: KeepaRawDeal[] } | null
  tokensLeft?: number
}

/**
 * Fetch active deals for a domain.
 * Uses deltaPercentRange with NEGATIVE values (Keepa convention for price drops):
 *   [-100, -minDiscountPct] = items at least minDiscountPct% below their reference price.
 * Returns deals sorted by discount % descending.
 * Costs ~50 tokens per call — do not call more than once per cron tick.
 *
 * @param domain         - Keepa domain ID (6 = Amazon.ca)
 * @param minDiscountPct - Minimum discount percentage (default 20)
 * @param limit          - Max deals to return (default 50, Keepa max 100)
 */
export async function getLightningDeals(
  domain = 6,
  minDiscountPct = 20,
  limit = 50
): Promise<{ deals: LightningDeal[]; tokensLeft: number | null; rawSample: unknown }> {
  if (!keepaConfigured()) return { deals: [], tokensLeft: null, rawSample: null }

  const apiKey = keepaKey()

  const selection = {
    domainId: domain,
    // Negative values = price drops. [-100, -minPct] = at least minPct% below reference.
    deltaPercentRange: [-100, -minDiscountPct],
    priceTypes: 1, // 1 = new (Amazon + marketplace new)
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
      return { deals: [], tokensLeft: null, rawSample: null }
    }
    json = (await res.json()) as KeepaDealsResponse
  } catch (e) {
    console.error('[lightning] fetch error:', e)
    return { deals: [], tokensLeft: null, rawSample: null }
  }

  const tokensLeft: number | null = json.tokensLeft ?? null
  const rawDeals: KeepaRawDeal[] = json.deals?.dr ?? []
  const rawSample: unknown = rawDeals.length > 0 ? rawDeals[0] : null

  const deals: LightningDeal[] = rawDeals
    .map((d) => {
      const typeIdx = currentPriceTypeIdx(d.current)
      const rawCurrent = extractCurrentPrice(d.current)
      const rawAvg = extractAvgPrice(d.avg, typeIdx)

      const dealPrice = rawCurrent != null ? rawCurrent / 100 : null
      const origPrice = rawAvg != null ? rawAvg / 100 : null

      let discountPct: number | null = null
      if (dealPrice != null && origPrice != null && origPrice > 0) {
        discountPct = ((origPrice - dealPrice) / origPrice) * 100
        if (discountPct < 0) discountPct = 0
      }

      const toDate = (mins: number | undefined): Date | null => {
        if (!mins || mins <= 0) return null
        return new Date(mins * 60_000 + KEEPA_EPOCH_MS)
      }

      return {
        asin: d.asin ?? '',
        title: d.title ?? null,
        dealPrice,
        origPrice,
        discountPct,
        dealType: d.lightningStart != null && d.lightningStart > 0 ? ('lightning' as const) : ('best' as const),
        startsAt: toDate(d.lightningStart),
        endsAt: toDate(d.lightningEnd),
      }
    })
    .filter((d) => d.asin.length > 0)

  // Sort by discount descending
  deals.sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0))

  return { deals, tokensLeft, rawSample }
}
