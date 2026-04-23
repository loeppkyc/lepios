import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock spFetch before importing the module under test ───────────────────────

vi.mock('@/lib/amazon/client', () => ({
  spFetch: vi.fn(),
  spApiConfigured: vi.fn(() => true),
}))

// Mock sleep to avoid 700ms delays in tests
vi.mock('@/lib/amazon/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/amazon/inventory')>()
  return actual
})

import { fetchFbaInventory } from '@/lib/amazon/inventory'
import { spFetch } from '@/lib/amazon/client'

const mockSpFetch = vi.mocked(spFetch)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSummary(fulfillable: number, sellerSku?: string) {
  return {
    sellerSku: sellerSku ?? `SKU-${Math.random().toString(36).slice(2)}`,
    totalQuantity: fulfillable + 5, // totalQuantity includes other states — must NOT be used
    inventoryDetails: {
      fulfillableQuantity: fulfillable,
      inboundWorkingQuantity: 1,
      inboundShippedQuantity: 2,
      reservedQuantity: { totalReservedQuantity: 1 },
      unfulfillableQuantity: { totalUnfulfillableQuantity: 1 },
    },
  }
}

function makeResponse(
  summaries: ReturnType<typeof makeSummary>[],
  nextToken?: string
) {
  return {
    payload: { inventorySummaries: summaries },
    ...(nextToken ? { pagination: { nextToken } } : {}),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fetchFbaInventory', () => {
  beforeEach(() => {
    mockSpFetch.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sums fulfillableQuantity across all summaries (Constraint B-7)', async () => {
    const summaries = [makeSummary(10), makeSummary(25), makeSummary(5)]
    mockSpFetch.mockResolvedValueOnce(makeResponse(summaries))

    const promise = fetchFbaInventory()
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.fulfillableUnits).toBe(40)
  })

  it('uses fulfillableQuantity not totalQuantity (Constraint B-7)', async () => {
    // totalQuantity = fulfillable + 5 in makeSummary helper
    const summary = makeSummary(100)
    mockSpFetch.mockResolvedValueOnce(makeResponse([summary]))

    const promise = fetchFbaInventory()
    await vi.runAllTimersAsync()
    const result = await promise

    // Must be 100, not 105
    expect(result.fulfillableUnits).toBe(100)
  })

  it('returns 0 on empty summaries list', async () => {
    mockSpFetch.mockResolvedValueOnce(makeResponse([]))

    const promise = fetchFbaInventory()
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.fulfillableUnits).toBe(0)
  })

  it('accumulates fulfillable units across paginated pages', async () => {
    const page1 = [makeSummary(100), makeSummary(50)]
    const page2 = [makeSummary(200), makeSummary(75)]

    mockSpFetch
      .mockResolvedValueOnce(makeResponse(page1, 'TOKEN-1'))
      .mockResolvedValueOnce(makeResponse(page2))

    const promise = fetchFbaInventory()
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.fulfillableUnits).toBe(425) // 100+50+200+75
    expect(mockSpFetch).toHaveBeenCalledTimes(2)
  })

  it('reads pagination token from body.pagination.nextToken (Constraint B-5)', async () => {
    // Simulate wrong location — nextToken in payload instead of top-level pagination
    // This should NOT paginate — no top-level pagination.nextToken present
    const wrongShape = {
      payload: {
        inventorySummaries: [makeSummary(10)],
        pagination: { nextToken: 'WRONG-LOCATION' }, // inside payload — must be ignored
      },
      // no top-level pagination → loop should stop after one page
    }

    mockSpFetch.mockResolvedValueOnce(wrongShape)

    const promise = fetchFbaInventory()
    await vi.runAllTimersAsync()
    const result = await promise

    // Only one page fetched; wrong-location token was not followed
    expect(mockSpFetch).toHaveBeenCalledTimes(1)
    expect(result.fulfillableUnits).toBe(10)
  })

  it('passes full param set on paginated requests (Constraint B-4)', async () => {
    mockSpFetch
      .mockResolvedValueOnce(makeResponse([makeSummary(1)], 'TOKEN-ABC'))
      .mockResolvedValueOnce(makeResponse([makeSummary(2)]))

    const promise = fetchFbaInventory()
    await vi.runAllTimersAsync()
    await promise

    const secondCallParams = (mockSpFetch.mock.calls[1][1] as { params: Record<string, string> })
      .params

    expect(secondCallParams.details).toBe('true')
    expect(secondCallParams.granularityType).toBe('Marketplace')
    expect(secondCallParams.granularityId).toBe('A2EUQ1WTGCTBG2')
    expect(secondCallParams.marketplaceIds).toBe('A2EUQ1WTGCTBG2')
    expect(secondCallParams.startDateTime).toBeDefined()
    expect(secondCallParams.nextToken).toBe('TOKEN-ABC')
  })

  it('includes startDateTime param on every request (Constraint B-3)', async () => {
    mockSpFetch.mockResolvedValueOnce(makeResponse([]))

    const promise = fetchFbaInventory()
    await vi.runAllTimersAsync()
    await promise

    const firstCallParams = (mockSpFetch.mock.calls[0][1] as { params: Record<string, string> })
      .params
    expect(firstCallParams.startDateTime).toBeDefined()
    // Must be an ISO timestamp approximately 90 days ago
    const startDt = new Date(firstCallParams.startDateTime)
    expect(isNaN(startDt.getTime())).toBe(false)
    const diffDays = (Date.now() - startDt.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThan(85)
    expect(diffDays).toBeLessThan(95)
  })

  it('returns fetchedAt as a valid ISO timestamp', async () => {
    mockSpFetch.mockResolvedValueOnce(makeResponse([]))

    const before = new Date().toISOString()
    const promise = fetchFbaInventory()
    await vi.runAllTimersAsync()
    const result = await promise
    const after = new Date().toISOString()

    expect(result.fetchedAt >= before).toBe(true)
    expect(result.fetchedAt <= after).toBe(true)
  })

  it('treats missing inventoryDetails.fulfillableQuantity as 0', async () => {
    const summary = {
      sellerSku: 'SKU-NO-DETAILS',
      totalQuantity: 5,
      // no inventoryDetails
    }
    mockSpFetch.mockResolvedValueOnce({ payload: { inventorySummaries: [summary] } })

    const promise = fetchFbaInventory()
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.fulfillableUnits).toBe(0)
  })
})
