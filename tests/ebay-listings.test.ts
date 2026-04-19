import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEbayFetch } = vi.hoisted(() => ({
  mockEbayFetch: vi.fn(),
}))

vi.mock('@/lib/ebay/client', () => ({
  ebayConfigured: vi.fn().mockReturnValue(true),
  ebayFetch: mockEbayFetch,
}))

import { getEbayListings } from '@/lib/ebay/listings'

const ISBN = '9780735211292'
const TITLE = 'Atomic Habits'

function makeResponse(prices: number[]) {
  return {
    total: prices.length,
    itemSummaries: prices.map((p) => ({
      price: { value: String(p), currency: 'CAD' },
    })),
  }
}

beforeEach(() => mockEbayFetch.mockReset())

describe('getEbayListings', () => {
  it('returns null when Browse API returns 0 items and no title fallback', async () => {
    mockEbayFetch.mockResolvedValue(makeResponse([]))
    const { listings } = await getEbayListings(ISBN)
    expect(listings).toBeNull()
  })

  it('returns correct median, low, high, count', async () => {
    mockEbayFetch.mockResolvedValue(makeResponse([10, 15, 20, 25, 30]))
    const { listings } = await getEbayListings(ISBN)
    expect(listings).not.toBeNull()
    expect(listings!.medianCad).toBe(20)
    expect(listings!.lowCad).toBe(10)
    expect(listings!.highCad).toBe(30)
    expect(listings!.count).toBe(5)
    expect(listings!.fallbackUsed).toBe(false)
  })

  it('computes median correctly for even-length array', async () => {
    mockEbayFetch.mockResolvedValue(makeResponse([10, 20, 30, 40]))
    const { listings } = await getEbayListings(ISBN)
    expect(listings!.medianCad).toBe(25)
  })

  it('fires title fallback when ISBN returns 0 results', async () => {
    mockEbayFetch
      .mockResolvedValueOnce(makeResponse([])) // ISBN query → 0
      .mockResolvedValueOnce(makeResponse([12, 18])) // title fallback → 2 results
    const { listings, fallbackReason } = await getEbayListings(ISBN, TITLE)
    expect(listings).not.toBeNull()
    expect(listings!.fallbackUsed).toBe(true)
    expect(fallbackReason).toBe('isbn_no_results')
  })

  it('does not fire fallback when ISBN returns results', async () => {
    mockEbayFetch.mockResolvedValue(makeResponse([14, 16]))
    const { listings, fallbackReason } = await getEbayListings(ISBN, TITLE)
    expect(listings!.fallbackUsed).toBe(false)
    expect(fallbackReason).toBeNull()
  })

  it('returns null with fallbackReason when both ISBN and title return 0', async () => {
    mockEbayFetch.mockResolvedValue(makeResponse([]))
    const { listings, fallbackReason } = await getEbayListings(ISBN, TITLE)
    expect(listings).toBeNull()
    expect(fallbackReason).toBe('isbn_no_results')
  })

  it('returns null gracefully when response has no itemSummaries', async () => {
    // Covers malformed/empty Browse API responses — same outcome as network failure
    mockEbayFetch.mockResolvedValue({ total: 0 })
    const { listings } = await getEbayListings(ISBN)
    expect(listings).toBeNull()
  })

  it('filters out zero-price items', async () => {
    mockEbayFetch.mockResolvedValue({
      total: 3,
      itemSummaries: [
        { price: { value: '0', currency: 'CAD' } },
        { price: { value: '15', currency: 'CAD' } },
        { price: { value: '20', currency: 'CAD' } },
      ],
    })
    const { listings } = await getEbayListings(ISBN)
    expect(listings!.count).toBe(2)
    expect(listings!.lowCad).toBe(15)
  })
})
