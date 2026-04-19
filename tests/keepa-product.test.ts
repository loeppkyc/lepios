import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock keepaFetch so tests never hit the network
const { mockKeepaFetch } = vi.hoisted(() => ({
  mockKeepaFetch: vi.fn(),
}))

vi.mock('@/lib/keepa/client', () => ({
  keepaConfigured: vi.fn().mockReturnValue(true),
  keepaFetch: mockKeepaFetch,
}))

import { getKeepaProduct } from '@/lib/keepa/product'

const ASIN = 'B0CX123456'

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    asin: ASIN,
    monthlySold: 45,
    stats: {
      current: [0, 0, 0, 42000],
      avg: [0, 0, 0, 55000],
      salesRankDrops30: 6,
    },
    ...overrides,
  }
}

beforeEach(() => {
  mockKeepaFetch.mockReset()
})

describe('getKeepaProduct', () => {
  it('returns null when keepaFetch returns no product', async () => {
    mockKeepaFetch.mockResolvedValue({ product: null, tokensLeft: 900 })
    expect(await getKeepaProduct(ASIN)).toBeNull()
  })

  it('extracts BSR, avgRank90d, rankDrops30, monthlySold correctly', async () => {
    mockKeepaFetch.mockResolvedValue({ product: makeProduct(), tokensLeft: 850 })
    const result = await getKeepaProduct(ASIN)
    expect(result).not.toBeNull()
    expect(result!.bsr).toBe(42000)
    expect(result!.avgRank90d).toBe(55000)
    expect(result!.rankDrops30).toBe(6)
    expect(result!.monthlySold).toBe(45)
    expect(result!.tokensLeft).toBe(850)
  })

  it('passes tokensLeft through for agent_events auditing', async () => {
    mockKeepaFetch.mockResolvedValue({ product: makeProduct(), tokensLeft: 712 })
    const result = await getKeepaProduct(ASIN)
    expect(result!.tokensLeft).toBe(712)
  })

  describe('velocityBadge thresholds', () => {
    it('Hot when rankDrops30 >= 8', async () => {
      mockKeepaFetch.mockResolvedValue({
        product: makeProduct({
          stats: { current: [0, 0, 0, 10000], avg: [], salesRankDrops30: 8 },
        }),
        tokensLeft: 900,
      })
      expect((await getKeepaProduct(ASIN))!.velocityBadge).toBe('Hot')
    })

    it('Hot when rankDrops30 > 8', async () => {
      mockKeepaFetch.mockResolvedValue({
        product: makeProduct({ stats: { current: [], avg: [], salesRankDrops30: 12 } }),
        tokensLeft: 900,
      })
      expect((await getKeepaProduct(ASIN))!.velocityBadge).toBe('Hot')
    })

    it('Warm when rankDrops30 >= 4 and < 8', async () => {
      mockKeepaFetch.mockResolvedValue({
        product: makeProduct({ stats: { current: [], avg: [], salesRankDrops30: 5 } }),
        tokensLeft: 900,
      })
      expect((await getKeepaProduct(ASIN))!.velocityBadge).toBe('Warm')
    })

    it('Slow when rankDrops30 is 0', async () => {
      mockKeepaFetch.mockResolvedValue({
        product: makeProduct({ stats: { current: [], avg: [], salesRankDrops30: 0 } }),
        tokensLeft: 900,
      })
      expect((await getKeepaProduct(ASIN))!.velocityBadge).toBe('Slow')
    })

    it('Slow when rankDrops30 is 1', async () => {
      mockKeepaFetch.mockResolvedValue({
        product: makeProduct({ stats: { current: [], avg: [], salesRankDrops30: 1 } }),
        tokensLeft: 900,
      })
      expect((await getKeepaProduct(ASIN))!.velocityBadge).toBe('Slow')
    })

    it('Warm via monthly_sold fallback when rankDrops30 is null', async () => {
      mockKeepaFetch.mockResolvedValue({
        product: { asin: ASIN, monthlySold: 35, stats: {} },
        tokensLeft: 900,
      })
      expect((await getKeepaProduct(ASIN))!.velocityBadge).toBe('Warm')
    })

    it('Slow via monthly_sold fallback when sold < 30', async () => {
      mockKeepaFetch.mockResolvedValue({
        product: { asin: ASIN, monthlySold: 10, stats: {} },
        tokensLeft: 900,
      })
      expect((await getKeepaProduct(ASIN))!.velocityBadge).toBe('Slow')
    })

    it('Unknown when no rank or monthly data', async () => {
      mockKeepaFetch.mockResolvedValue({
        product: { asin: ASIN, monthlySold: -1, stats: {} },
        tokensLeft: 900,
      })
      expect((await getKeepaProduct(ASIN))!.velocityBadge).toBe('Unknown')
    })
  })

  it('treats monthlySold -1 as unknown', async () => {
    mockKeepaFetch.mockResolvedValue({
      product: { asin: ASIN, monthlySold: -1, stats: {} },
      tokensLeft: 900,
    })
    const result = await getKeepaProduct(ASIN)
    expect(result!.monthlySold).toBeNull()
  })

  it('returns null BSR when stats.current[3] is 0 or missing', async () => {
    mockKeepaFetch.mockResolvedValue({
      product: { asin: ASIN, stats: { current: [0, 0, 0, 0], avg: [] } },
      tokensLeft: 900,
    })
    const result = await getKeepaProduct(ASIN)
    expect(result!.bsr).toBeNull()
  })
})
