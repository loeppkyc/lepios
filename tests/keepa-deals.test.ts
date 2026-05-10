import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock keepaConfigured + underlying fetch so we never hit the network
vi.mock('@/lib/keepa/client', () => ({
  keepaConfigured: vi.fn().mockReturnValue(true),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock process.env so keepaKey() returns something
vi.stubEnv('KEEPA_API_KEY', 'test-key')

import {
  scanCategoryDeals,
  getBestSellerAsins,
  CA_CATEGORIES,
  US_CATEGORIES,
  lookupAlertPrice,
} from '@/lib/keepa/deals'

// ── Helpers ───────────────────────────────────────────────────────────────────

function bestSellersResponse(asins: string[]) {
  return { bestSellersList: [{ asinList: asins }] }
}

/** current[0]=price units (hundredths), current[3]=BSR, avg[0]=avg90d units */
function productResponse(
  products: Array<{
    asin: string
    currentUnits?: number
    avgUnits?: number
    bsr?: number
    title?: string
  }>
) {
  return {
    products: products.map((p) => ({
      asin: p.asin,
      title: p.title ?? p.asin,
      stats: {
        current: [p.currentUnits ?? 2999, 0, 0, p.bsr ?? 10000],
        avg: [p.avgUnits ?? 3999, 0, 0, 0],
      },
    })),
  }
}

function okJson(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as unknown as Response
}

beforeEach(() => {
  mockFetch.mockReset()
})

// ── CA_CATEGORIES / US_CATEGORIES sanity ──────────────────────────────────────

describe('category maps', () => {
  it('CA_CATEGORIES has Books entry', () => {
    expect(CA_CATEGORIES['Books']).toBeGreaterThan(0)
  })

  it('US_CATEGORIES has Books entry', () => {
    expect(US_CATEGORIES['Books']).toBeGreaterThan(0)
  })

  it('CA and US Books have different node IDs', () => {
    expect(CA_CATEGORIES['Books']).not.toBe(US_CATEGORIES['Books'])
  })
})

// ── getBestSellerAsins ────────────────────────────────────────────────────────

describe('getBestSellerAsins', () => {
  it('returns asinList from API', async () => {
    mockFetch.mockResolvedValueOnce(okJson(bestSellersResponse(['B001', 'B002', 'B003'])))
    const result = await getBestSellerAsins(927726, 6, 10)
    expect(result).toEqual(['B001', 'B002', 'B003'])
  })

  it('respects the limit parameter', async () => {
    const asins = Array.from({ length: 20 }, (_, i) => `B${String(i).padStart(3, '0')}`)
    mockFetch.mockResolvedValueOnce(okJson(bestSellersResponse(asins)))
    const result = await getBestSellerAsins(927726, 6, 5)
    expect(result).toHaveLength(5)
  })

  it('returns empty array on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'))
    const result = await getBestSellerAsins(927726, 6, 10)
    expect(result).toEqual([])
  })

  it('returns empty array on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response)
    const result = await getBestSellerAsins(927726, 6, 10)
    expect(result).toEqual([])
  })

  it('returns empty array when bestSellersList is missing', async () => {
    mockFetch.mockResolvedValueOnce(okJson({}))
    const result = await getBestSellerAsins(927726, 6, 10)
    expect(result).toEqual([])
  })
})

// ── scanCategoryDeals — price conversion ──────────────────────────────────────

describe('scanCategoryDeals — price conversion (keepaPriceToCAD)', () => {
  it('converts Keepa integer units to CAD (units / 100)', async () => {
    // current=1999 → $19.99, avg=2999 → $29.99, discount ≈ 33.4%
    mockFetch
      .mockResolvedValueOnce(okJson(bestSellersResponse(['B001'])))
      .mockResolvedValueOnce(
        okJson(productResponse([{ asin: 'B001', currentUnits: 1999, avgUnits: 2999, bsr: 1000 }]))
      )

    const deals = await scanCategoryDeals({
      categoryId: 927726,
      categoryName: 'Books',
      domain: 6,
      minDiscountPct: 20,
      maxBsr: 500000,
      limit: 10,
    })
    expect(deals).toHaveLength(1)
    expect(deals[0]!.currentPriceCad).toBe(19.99)
    expect(deals[0]!.avg90dPriceCad).toBe(29.99)
  })

  it('skips products where current price is -1 (unavailable)', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(bestSellersResponse(['B001'])))
      .mockResolvedValueOnce(
        okJson(productResponse([{ asin: 'B001', currentUnits: -1, avgUnits: 2999, bsr: 1000 }]))
      )

    const deals = await scanCategoryDeals({
      categoryId: 927726,
      categoryName: 'Books',
      domain: 6,
      minDiscountPct: 0,
      maxBsr: 500000,
      limit: 10,
    })
    expect(deals).toHaveLength(0)
  })

  it('skips products where avg price is -1 (no history)', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(bestSellersResponse(['B001'])))
      .mockResolvedValueOnce(
        okJson(productResponse([{ asin: 'B001', currentUnits: 1999, avgUnits: -1, bsr: 1000 }]))
      )

    const deals = await scanCategoryDeals({
      categoryId: 927726,
      categoryName: 'Books',
      domain: 6,
      minDiscountPct: 0,
      maxBsr: 500000,
      limit: 10,
    })
    expect(deals).toHaveLength(0)
  })
})

// ── scanCategoryDeals — filtering ─────────────────────────────────────────────

describe('scanCategoryDeals — discount filter', () => {
  it('excludes deals below minDiscountPct', async () => {
    // current=2700, avg=2999 → discount ≈ 9.97% — below 20%
    mockFetch
      .mockResolvedValueOnce(okJson(bestSellersResponse(['B001'])))
      .mockResolvedValueOnce(
        okJson(productResponse([{ asin: 'B001', currentUnits: 2700, avgUnits: 2999, bsr: 1000 }]))
      )

    const deals = await scanCategoryDeals({
      categoryId: 927726,
      categoryName: 'Books',
      domain: 6,
      minDiscountPct: 20,
      maxBsr: 500000,
      limit: 10,
    })
    expect(deals).toHaveLength(0)
  })

  it('includes deals at exactly minDiscountPct', async () => {
    // current=2400, avg=3000 → discount = 20%
    mockFetch
      .mockResolvedValueOnce(okJson(bestSellersResponse(['B001'])))
      .mockResolvedValueOnce(
        okJson(productResponse([{ asin: 'B001', currentUnits: 2400, avgUnits: 3000, bsr: 1000 }]))
      )

    const deals = await scanCategoryDeals({
      categoryId: 927726,
      categoryName: 'Books',
      domain: 6,
      minDiscountPct: 20,
      maxBsr: 500000,
      limit: 10,
    })
    expect(deals).toHaveLength(1)
    expect(deals[0]!.discountPct).toBe(20)
  })
})

describe('scanCategoryDeals — BSR filter', () => {
  it('excludes products with BSR above maxBsr', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(bestSellersResponse(['B001'])))
      .mockResolvedValueOnce(
        okJson(productResponse([{ asin: 'B001', currentUnits: 1000, avgUnits: 3000, bsr: 600000 }]))
      )

    const deals = await scanCategoryDeals({
      categoryId: 927726,
      categoryName: 'Books',
      domain: 6,
      minDiscountPct: 20,
      maxBsr: 500000,
      limit: 10,
    })
    expect(deals).toHaveLength(0)
  })

  it('includes products with BSR equal to maxBsr', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(bestSellersResponse(['B001'])))
      .mockResolvedValueOnce(
        okJson(productResponse([{ asin: 'B001', currentUnits: 1000, avgUnits: 3000, bsr: 500000 }]))
      )

    const deals = await scanCategoryDeals({
      categoryId: 927726,
      categoryName: 'Books',
      domain: 6,
      minDiscountPct: 20,
      maxBsr: 500000,
      limit: 10,
    })
    expect(deals).toHaveLength(1)
  })
})

describe('scanCategoryDeals — sort order', () => {
  it('returns deals sorted by discountPct descending', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(bestSellersResponse(['B001', 'B002'])))
      .mockResolvedValueOnce(
        okJson(
          productResponse([
            { asin: 'B001', currentUnits: 2500, avgUnits: 3000, bsr: 1000 }, // 16.7%
            { asin: 'B002', currentUnits: 1000, avgUnits: 3000, bsr: 2000 }, // 66.7%
          ])
        )
      )

    const deals = await scanCategoryDeals({
      categoryId: 927726,
      categoryName: 'Books',
      domain: 6,
      minDiscountPct: 10,
      maxBsr: 500000,
      limit: 10,
    })
    expect(deals[0]!.asin).toBe('B002')
    expect(deals[1]!.asin).toBe('B001')
    expect(deals[0]!.discountPct).toBeGreaterThan(deals[1]!.discountPct)
  })
})

describe('scanCategoryDeals — empty cases', () => {
  it('returns empty when bestsellers fetch returns no ASINs', async () => {
    mockFetch.mockResolvedValueOnce(okJson(bestSellersResponse([])))
    const deals = await scanCategoryDeals({
      categoryId: 927726,
      categoryName: 'Books',
      domain: 6,
      minDiscountPct: 20,
      maxBsr: 500000,
      limit: 10,
    })
    expect(deals).toEqual([])
  })
})

// ── lookupAlertPrice ──────────────────────────────────────────────────────────

describe('lookupAlertPrice', () => {
  it('returns price and bsr for a valid product', async () => {
    mockFetch.mockResolvedValueOnce(
      okJson(productResponse([{ asin: 'B001', currentUnits: 3499, avgUnits: 5000, bsr: 42000 }]))
    )
    const result = await lookupAlertPrice('B001', 6)
    expect(result.price).toBe(34.99)
    expect(result.bsr).toBe(42000)
  })

  it('returns null price when units are -1', async () => {
    mockFetch.mockResolvedValueOnce(
      okJson(productResponse([{ asin: 'B001', currentUnits: -1, avgUnits: 5000, bsr: 42000 }]))
    )
    const result = await lookupAlertPrice('B001', 6)
    expect(result.price).toBeNull()
  })

  it('returns all nulls when product is not found', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ products: [] }))
    const result = await lookupAlertPrice('BADABC', 6)
    expect(result.price).toBeNull()
    expect(result.bsr).toBeNull()
    expect(result.tokensLeft).toBeNull()
  })
})
