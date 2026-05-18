/**
 * lib/keepa/bestsellers.ts
 *
 * Fetches bestseller ASIN lists from Keepa for a given category and domain.
 *
 * Keepa /bestsellers endpoint: GET https://api.keepa.com/bestsellers?key=<KEY>&domain=<D>&category=<ID>
 * Cost: ~50 tokens per category call (flat, not per-ASIN).
 * Returns up to 10,000 ASINs (first page of the bestseller list).
 *
 * Response shape:
 *   { categories: { "<catId>": { bestSellersList: string[] } }, tokensLeft: number }
 */

import { keepaConfigured } from './client'

const KEEPA_BASE = 'https://api.keepa.com'

function keepaKey(): string {
  return process.env.KEEPA_API_KEY ?? ''
}

export interface BestsellerCategory {
  id: bigint | number
  name: string
  slug: string // matches asin_catalog.category column
}

/**
 * Categories to harvest on the weekly Sunday run.
 * Category IDs are Keepa numeric node IDs for Amazon.ca (domain=6).
 * Slug values must stay in sync with the CHECK constraint on asin_catalog.category.
 */
export const HARVEST_CATEGORIES: BestsellerCategory[] = [
  { id: 916520, name: 'Books', slug: 'books' },
  { id: 6205124011, name: 'Toys', slug: 'toys' },
  { id: 166114011, name: 'LEGO', slug: 'lego' },
  { id: 3198031, name: 'Video Games', slug: 'video_games' },
  { id: 6205517011, name: 'Board Games', slug: 'board_games' },
  { id: 2206275011, name: 'Home', slug: 'home' },
  { id: 2242989011, name: 'Sports', slug: 'sports' },
]

interface KeepaCategory {
  bestSellersList?: string[]
}

interface KeepabestsellersResponse {
  categories?: Record<string, KeepaCategory>
  tokensLeft?: number
}

/**
 * Fetch the bestseller ASIN list for a single category.
 *
 * @param categoryId - Keepa numeric category ID (matches BestsellerCategory.id)
 * @param domain     - Keepa domain (6 = Amazon.ca). Default: 6.
 * @returns          - asins: ordered bestseller list; tokensLeft: remaining API tokens.
 *
 * Costs ~50 tokens per call regardless of result size.
 * Returns empty array + null tokensLeft if Keepa is not configured or call fails.
 */
export async function getBestsellerAsins(
  categoryId: bigint | number,
  domain = 6
): Promise<{ asins: string[]; tokensLeft: number | null }> {
  if (!keepaConfigured()) return { asins: [], tokensLeft: null }

  const apiKey = keepaKey()
  const url = new URL(`${KEEPA_BASE}/bestsellers`)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('domain', String(domain))
  url.searchParams.set('category', String(categoryId))

  let res: Response
  try {
    res = await fetch(url.toString(), { next: { revalidate: 0 } })
  } catch (e) {
    console.error(`[bestsellers] network error for category ${categoryId}:`, e)
    return { asins: [], tokensLeft: null }
  }

  if (!res.ok) {
    console.error(`[bestsellers] ${res.status} for category ${categoryId}`)
    return { asins: [], tokensLeft: null }
  }

  let json: KeepabestsellersResponse
  try {
    json = (await res.json()) as KeepabestsellersResponse
  } catch (e) {
    console.error(`[bestsellers] JSON parse error for category ${categoryId}:`, e)
    return { asins: [], tokensLeft: null }
  }

  // Log response shape to diagnose category ID / key mismatches
  const catKeys = Object.keys(json.categories ?? {})
  console.log(
    `[bestsellers] cat=${categoryId} domain=${domain} tokensLeft=${json.tokensLeft} catKeys=${catKeys.join(',')} rawPreview=${JSON.stringify(json).slice(0, 300)}`
  )

  const catKey = String(categoryId)
  const asins = json.categories?.[catKey]?.bestSellersList ?? []

  return {
    asins,
    tokensLeft: json.tokensLeft ?? null,
  }
}
