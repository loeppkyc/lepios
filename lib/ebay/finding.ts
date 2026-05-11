const FINDING_BASE = 'https://svcs.ebay.com/services/search/FindingService/v1'

// eBay Books category — same as active listings
const BOOKS_CATEGORY_ID = '267'

export interface EbaySoldComps {
  avgSoldCad: number
  lowSoldCad: number
  highSoldCad: number
  soldCount: number
  fallbackUsed: boolean
}

function findingConfigured(): boolean {
  return Boolean(process.env.EBAY_APP_ID)
}

async function findingFetch(params: Record<string, string>): Promise<unknown> {
  const appId = process.env.EBAY_APP_ID ?? ''
  const url = new URL(FINDING_BASE)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString(), {
    headers: {
      'X-EBAY-SOA-OPERATION-NAME': 'findCompletedItems',
      'X-EBAY-SOA-SECURITY-APPNAME': appId,
      'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'JSON',
      'X-EBAY-SOA-SERVICE-VERSION': '1.13.0',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`eBay Finding API (${res.status}): ${text.slice(0, 200)}`)
  }

  return res.json()
}

function buildParams(keywords: string): Record<string, string> {
  return {
    keywords,
    categoryId: BOOKS_CATEGORY_ID,
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'itemFilter(1).name': 'ListingType',
    'itemFilter(1).value': 'FixedPrice',
    'itemFilter(2).name': 'Condition',
    'itemFilter(2).value': 'Used',
    outputSelector: 'SellingStatus',
    'paginationInput.entriesPerPage': '20',
  }
}

function parsePrices(response: unknown): number[] {
  try {
    const r = response as Record<string, unknown>
    const wrapper = (r['findCompletedItemsResponse'] as Record<string, unknown>[])[0]
    const searchResult = (wrapper['searchResult'] as Record<string, unknown>[])[0]
    const items = (searchResult['item'] as Record<string, unknown>[]) ?? []
    return items
      .map((item) => {
        const ss = (item['sellingStatus'] as Record<string, unknown>[])[0]
        const cp = (ss['currentPrice'] as Record<string, unknown>[])[0]
        return parseFloat(cp['__value__'] as string)
      })
      .filter((p) => !isNaN(p) && p > 0)
  } catch {
    return []
  }
}

async function fetchSoldPrices(keywords: string): Promise<number[]> {
  try {
    const data = await findingFetch(buildParams(keywords))
    return parsePrices(data)
  } catch {
    return []
  }
}

export async function getSoldComps(
  isbn: string,
  titleFallback?: string
): Promise<{ comps: EbaySoldComps | null; fallbackReason: string | null }> {
  if (!findingConfigured()) return { comps: null, fallbackReason: null }

  // Primary: ISBN search
  let prices = await fetchSoldPrices(isbn)
  let fallbackUsed = false
  let fallbackReason: string | null = null

  // Fallback: title keyword when ISBN returns 0 results
  if (prices.length === 0 && titleFallback) {
    fallbackUsed = true
    fallbackReason = 'isbn_no_results'
    prices = await fetchSoldPrices(titleFallback.slice(0, 60))
  }

  if (prices.length === 0) return { comps: null, fallbackReason }

  const avg = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100
  const low = Math.round(Math.min(...prices) * 100) / 100
  const high = Math.round(Math.max(...prices) * 100) / 100

  return {
    comps: {
      avgSoldCad: avg,
      lowSoldCad: low,
      highSoldCad: high,
      soldCount: prices.length,
      fallbackUsed,
    },
    fallbackReason,
  }
}
