import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ISBN = '9780307887436'
const TITLE = 'The Lean Startup'

// Build a valid Finding API response for the given prices
function makeResponse(prices: number[]) {
  return {
    findCompletedItemsResponse: [
      {
        searchResult: [
          {
            item: prices.map((p) => ({
              sellingStatus: [
                {
                  currentPrice: [{ __value__: String(p) }],
                },
              ],
            })),
          },
        ],
      },
    ],
  }
}

// Build a zero-results response (no item key)
function makeEmptyResponse() {
  return {
    findCompletedItemsResponse: [
      {
        searchResult: [{}],
      },
    ],
  }
}

describe('getSoldComps', () => {
  beforeEach(() => {
    vi.stubEnv('EBAY_APP_ID', 'test-app-id')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns null when EBAY_APP_ID is undefined', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('EBAY_APP_ID', '')
    // Re-import inside the test to pick up the env change; since modules are cached,
    // we call after stubbing and rely on findingConfigured() checking at call time
    const { getSoldComps } = await import('@/lib/ebay/finding')
    const result = await getSoldComps(ISBN)
    expect(result.comps).toBeNull()
    expect(result.fallbackReason).toBeNull()
  })

  it('parses avg, low, high correctly from a valid response', async () => {
    const prices = [10, 15, 20, 25, 30]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeResponse(prices),
    } as Response)

    const { getSoldComps } = await import('@/lib/ebay/finding')
    const { comps } = await getSoldComps(ISBN)
    expect(comps).not.toBeNull()
    expect(comps!.soldCount).toBe(5)
    expect(comps!.avgSoldCad).toBe(20)
    expect(comps!.lowSoldCad).toBe(10)
    expect(comps!.highSoldCad).toBe(30)
    expect(comps!.fallbackUsed).toBe(false)
  })

  it('triggers fallback when ISBN returns 0 results', async () => {
    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++
      const body = callCount === 1 ? makeEmptyResponse() : makeResponse([12, 18])
      return { ok: true, json: async () => body } as Response
    })

    const { getSoldComps } = await import('@/lib/ebay/finding')
    const { comps, fallbackReason } = await getSoldComps(ISBN, TITLE)
    expect(comps).not.toBeNull()
    expect(comps!.fallbackUsed).toBe(true)
    expect(fallbackReason).toBe('isbn_no_results')
    expect(callCount).toBe(2)
  })

  it('returns null when both ISBN and title fallback return 0 results', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeEmptyResponse(),
    } as Response)

    const { getSoldComps } = await import('@/lib/ebay/finding')
    const { comps, fallbackReason } = await getSoldComps(ISBN, TITLE)
    expect(comps).toBeNull()
    expect(fallbackReason).toBe('isbn_no_results')
  })

  it('returns null without triggering fallback when no title is given and ISBN returns 0 results', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeEmptyResponse(),
    } as Response)

    const { getSoldComps } = await import('@/lib/ebay/finding')
    const { comps, fallbackReason } = await getSoldComps(ISBN)
    expect(comps).toBeNull()
    expect(fallbackReason).toBeNull()
  })
})
