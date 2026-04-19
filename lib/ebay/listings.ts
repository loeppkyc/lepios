import { ebayConfigured, ebayFetch } from './client'

// eBay Books category. Some books are listed outside 267 (textbooks, collectibles).
// Title keyword fallback catches those when ISBN+cat267 returns 0.
// If ebay_fallback_reason fires frequently on findable books, category filter is likely why.
const BOOKS_CATEGORY_ID = '267'

export interface EbayListings {
  medianCad: number
  lowCad: number
  highCad: number
  count: number
  fallbackUsed: boolean
}

interface BrowseItem {
  price?: { value: string; currency: string }
}

interface BrowseResponse {
  total?: number
  itemSummaries?: BrowseItem[]
}

function median(prices: number[]): number {
  const sorted = [...prices].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100
    : sorted[mid]
}

async function searchListings(q: string): Promise<number[]> {
  try {
    const data = await ebayFetch<BrowseResponse>('/item_summary/search', {
      q,
      limit: '20',
      category_ids: BOOKS_CATEGORY_ID,
      filter: 'conditions:{USED}',
    })
    return (data.itemSummaries ?? [])
      .map((item) => parseFloat(item.price?.value ?? '0'))
      .filter((p) => p > 0)
  } catch {
    return []
  }
}

export async function getEbayListings(
  isbn: string,
  titleFallback?: string
): Promise<{ listings: EbayListings | null; fallbackReason: string | null }> {
  if (!ebayConfigured()) return { listings: null, fallbackReason: null }

  // Primary: ISBN query
  let prices = await searchListings(isbn)
  let fallbackUsed = false
  let fallbackReason: string | null = null

  // Fallback: title keyword when ISBN returns 0 results
  if (prices.length === 0 && titleFallback) {
    fallbackUsed = true
    fallbackReason = 'isbn_no_results'
    prices = await searchListings(titleFallback.slice(0, 60))
  }

  if (prices.length === 0) return { listings: null, fallbackReason }

  return {
    listings: {
      medianCad: median(prices),
      lowCad: Math.round(Math.min(...prices) * 100) / 100,
      highCad: Math.round(Math.max(...prices) * 100) / 100,
      count: prices.length,
      fallbackUsed,
    },
    fallbackReason,
  }
}
