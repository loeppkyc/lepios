import { keepaConfigured } from './client'

const KEEPA_BASE = 'https://api.keepa.com'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProductFinderFilters {
  domain?: number
  categoryId?: number
  minRank?: number
  maxRank?: number
  minPriceCad?: number
  maxPriceCad?: number
  minRating?: number // 0–5 (stored as x10 in Keepa)
  minReviews?: number
  minDiscount?: number // percent
  limit?: number // max 50
}

export interface FoundProduct {
  asin: string
  title: string | null
  currentPrice: number | null
  avgPrice90d: number | null
  salesRank: number | null
  rating: number | null // out of 5
  reviewCount: number | null
  discountPct: number | null
}

export interface CategoryInfo {
  catId: number
  name: string
  parentId: number | null
  children: number[]
}

export interface SellerInfo {
  sellerId: string
  name: string | null
  rating: number | null
  reviewCount: number | null
  country: string | null
  products: number | null
}

// ── Internal types for Keepa API responses ────────────────────────────────────

interface KeepaProductRaw {
  asin: string
  title?: string
  avgRating?: number
  ratingCount?: number
  stats?: {
    current?: number[]
    avg?: number[]
  }
}

interface KeepaQueryResponse {
  products?: KeepaProductRaw[]
  tokensLeft?: number
}

interface KeepaCategoryRaw {
  name: string
  parent?: number
  children?: number[]
}

interface KeepaCategoryResponse {
  categories?: Record<string, KeepaCategoryRaw>
  tokensLeft?: number
}

interface KeepaSellerRaw {
  sellerName?: string
  sellerRating?: number
  sellerRatingCount?: number
  country?: string
  totalStorefrontProducts?: number
}

interface KeepaSellerResponse {
  sellers?: Record<string, KeepaSellerRaw>
  tokensLeft?: number
}

// ── Product Finder ─────────────────────────────────────────────────────────────

/**
 * Keepa Product Finder — filtered ASIN search by rank, price, rating, discount.
 * Uses Keepa /query endpoint. Token cost: ~1 token per product returned.
 * F7: never pass history=1 — stats only.
 */
export async function productFinder(
  filters: ProductFinderFilters
): Promise<{ products: FoundProduct[]; tokensLeft: number | null }> {
  if (!keepaConfigured()) return { products: [], tokensLeft: null }
  const apiKey = process.env.KEEPA_API_KEY!
  const domain = filters.domain ?? 6 // 6 = Canada

  const selection: Record<string, unknown> = {
    domainId: domain,
    page: 0,
    perPage: Math.min(filters.limit ?? 20, 50),
    sortType: 0, // sort by sales rank
    sortOrder: 0, // ascending (best rank first)
  }

  if (filters.categoryId) selection.categories = [filters.categoryId]
  if (filters.minRank) selection.salesRankMin = filters.minRank
  if (filters.maxRank) selection.salesRankMax = filters.maxRank
  if (filters.minPriceCad) selection.priceMin = [Math.round(filters.minPriceCad * 100)]
  if (filters.maxPriceCad) selection.priceMax = [Math.round(filters.maxPriceCad * 100)]
  if (filters.minRating) selection.avgRatingMin = Math.round(filters.minRating * 10)
  if (filters.minReviews) selection.reviewCountMin = filters.minReviews
  if (filters.minDiscount) selection.deltaPercentMin = filters.minDiscount

  try {
    const url = `${KEEPA_BASE}/query?key=${apiKey}&selection=${encodeURIComponent(JSON.stringify(selection))}`
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) {
      console.error(`[productFinder] Keepa /query returned ${res.status}`)
      return { products: [], tokensLeft: null }
    }
    const json = (await res.json()) as KeepaQueryResponse

    const products: FoundProduct[] = (json.products ?? []).map((p) => {
      const current = p.stats?.current?.[0]
      const avg = p.stats?.avg?.[0]
      const currentPrice = current != null && current >= 0 ? current / 100 : null
      const avgPrice90d = avg != null && avg >= 0 ? avg / 100 : null
      const discountPct =
        current != null && avg != null && avg > 0 && current >= 0
          ? Math.round((1 - current / avg) * 100)
          : null

      return {
        asin: p.asin,
        title: p.title ?? null,
        currentPrice,
        avgPrice90d,
        salesRank: p.stats?.current?.[3] ?? null,
        rating: p.avgRating != null ? p.avgRating / 10 : null,
        reviewCount: p.ratingCount ?? null,
        discountPct,
      }
    })

    return { products, tokensLeft: json.tokensLeft ?? null }
  } catch (err) {
    console.error('[productFinder] error:', err)
    return { products: [], tokensLeft: null }
  }
}

// ── Category Info ─────────────────────────────────────────────────────────────

/**
 * Look up a Keepa category by ID — returns name, parent, and children.
 * Cached 1 hour (category tree changes infrequently).
 * Token cost: ~1 token per call.
 */
export async function getCategoryInfo(
  categoryId: number,
  domain = 6
): Promise<{ category: CategoryInfo | null; tokensLeft: number | null }> {
  if (!keepaConfigured()) return { category: null, tokensLeft: null }
  const apiKey = process.env.KEEPA_API_KEY!

  try {
    const res = await fetch(
      `${KEEPA_BASE}/category?key=${apiKey}&domain=${domain}&category=${categoryId}&parents=1`,
      { next: { revalidate: 3600 } }
    )
    if (!res.ok) {
      console.error(`[getCategoryInfo] Keepa /category returned ${res.status}`)
      return { category: null, tokensLeft: null }
    }
    const json = (await res.json()) as KeepaCategoryResponse
    const cats = json.categories ?? {}
    const cat = cats[String(categoryId)]
    if (!cat) return { category: null, tokensLeft: json.tokensLeft ?? null }

    return {
      category: {
        catId: categoryId,
        name: cat.name,
        parentId: cat.parent ?? null,
        children: cat.children ?? [],
      },
      tokensLeft: json.tokensLeft ?? null,
    }
  } catch (err) {
    console.error('[getCategoryInfo] error:', err)
    return { category: null, tokensLeft: null }
  }
}

// ── Seller Info ───────────────────────────────────────────────────────────────

/**
 * Look up a seller by Seller ID — returns name, rating, country, product count.
 * Token cost: ~1 token per call.
 */
export async function getSellerInfo(
  sellerId: string,
  domain = 6
): Promise<{ seller: SellerInfo | null; tokensLeft: number | null }> {
  if (!keepaConfigured()) return { seller: null, tokensLeft: null }
  const apiKey = process.env.KEEPA_API_KEY!

  try {
    const res = await fetch(
      `${KEEPA_BASE}/seller?key=${apiKey}&domain=${domain}&seller=${encodeURIComponent(sellerId)}`,
      { next: { revalidate: 0 } }
    )
    if (!res.ok) {
      console.error(`[getSellerInfo] Keepa /seller returned ${res.status}`)
      return { seller: null, tokensLeft: null }
    }
    const json = (await res.json()) as KeepaSellerResponse
    const s = json.sellers?.[sellerId]
    if (!s) return { seller: null, tokensLeft: json.tokensLeft ?? null }

    return {
      seller: {
        sellerId,
        name: s.sellerName ?? null,
        rating: s.sellerRating ?? null,
        reviewCount: s.sellerRatingCount ?? null,
        country: s.country ?? null,
        products: s.totalStorefrontProducts ?? null,
      },
      tokensLeft: json.tokensLeft ?? null,
    }
  } catch (err) {
    console.error('[getSellerInfo] error:', err)
    return { seller: null, tokensLeft: null }
  }
}
