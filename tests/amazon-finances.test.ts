import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockSpFetch } = vi.hoisted(() => ({
  mockSpFetch: vi.fn(),
}))

vi.mock('@/lib/amazon/client', () => ({
  spFetch: mockSpFetch,
}))

// logEvent is called by client.ts on 429 — mock to prevent real HTTP
vi.mock('@/lib/knowledge/client', () => ({
  logEvent: vi.fn().mockResolvedValue(null),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeGroup(id: string, currency = 'CAD') {
  return {
    FinancialEventGroupId: id,
    FinancialEventGroupStart: '2026-04-01T00:00:00Z',
    OriginalTotal: { CurrencyCode: currency, CurrencyAmount: 100.0 },
  }
}

function makeApiResponse(groups: object[], nextToken?: string) {
  return {
    payload: {
      FinancialEventGroupList: groups,
      ...(nextToken ? { NextToken: nextToken } : {}),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── fetchAllFinancialEventGroups ──────────────────────────────────────────────

describe('fetchAllFinancialEventGroups', () => {
  it('single page — returns all groups from one API call', async () => {
    mockSpFetch.mockResolvedValueOnce(
      makeApiResponse([makeGroup('FEG-001'), makeGroup('FEG-002')])
    )

    const { fetchAllFinancialEventGroups } = await import('@/lib/amazon/finances')
    const result = await fetchAllFinancialEventGroups(35)

    expect(result).toHaveLength(2)
    expect(result[0].FinancialEventGroupId).toBe('FEG-001')
    expect(result[1].FinancialEventGroupId).toBe('FEG-002')
    expect(mockSpFetch).toHaveBeenCalledTimes(1)
    expect(mockSpFetch).toHaveBeenCalledWith('/finances/v0/financialEventGroups', {
      method: 'GET',
      params: expect.objectContaining({ FinancialEventGroupStartedAfter: expect.any(String) }),
    })
  })

  it('multi-page — follows NextToken until exhausted', async () => {
    mockSpFetch
      .mockResolvedValueOnce(makeApiResponse([makeGroup('FEG-001')], 'token-page-2'))
      .mockResolvedValueOnce(makeApiResponse([makeGroup('FEG-002')], 'token-page-3'))
      .mockResolvedValueOnce(makeApiResponse([makeGroup('FEG-003')]))

    const { fetchAllFinancialEventGroups } = await import('@/lib/amazon/finances')
    const result = await fetchAllFinancialEventGroups(35)

    expect(result).toHaveLength(3)
    expect(result.map((g) => g.FinancialEventGroupId)).toEqual(['FEG-001', 'FEG-002', 'FEG-003'])
    expect(mockSpFetch).toHaveBeenCalledTimes(3)
    // Second call uses NextToken, not date params
    expect(mockSpFetch).toHaveBeenNthCalledWith(2, '/finances/v0/financialEventGroups', {
      method: 'GET',
      params: { NextToken: 'token-page-2' },
    })
  })

  it('empty result — returns empty array', async () => {
    mockSpFetch.mockResolvedValueOnce(makeApiResponse([]))

    const { fetchAllFinancialEventGroups } = await import('@/lib/amazon/finances')
    const result = await fetchAllFinancialEventGroups(35)

    expect(result).toHaveLength(0)
    expect(mockSpFetch).toHaveBeenCalledTimes(1)
  })

  it('missing FinancialEventGroupList in payload — returns empty array', async () => {
    mockSpFetch.mockResolvedValueOnce({ payload: {} })

    const { fetchAllFinancialEventGroups } = await import('@/lib/amazon/finances')
    const result = await fetchAllFinancialEventGroups(35)

    expect(result).toHaveLength(0)
  })

  it('daysBack controls FinancialEventGroupStartedAfter date range', async () => {
    mockSpFetch.mockResolvedValueOnce(makeApiResponse([]))
    const before = Date.now()

    const { fetchAllFinancialEventGroups } = await import('@/lib/amazon/finances')
    await fetchAllFinancialEventGroups(7)

    const after = Date.now()
    const calledParams = mockSpFetch.mock.calls[0][1].params
    const startedAfter = new Date(calledParams.FinancialEventGroupStartedAfter).getTime()

    // Should be approximately 7 days ago (allow ±5s for test execution time)
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    expect(startedAfter).toBeGreaterThanOrEqual(before - sevenDaysMs - 5000)
    expect(startedAfter).toBeLessThanOrEqual(after - sevenDaysMs + 5000)
  })

  it('spFetch throws (e.g. max retries exceeded) — propagates error', async () => {
    mockSpFetch.mockRejectedValueOnce(new Error('SP-API rate limited after 3 retries'))

    const { fetchAllFinancialEventGroups } = await import('@/lib/amazon/finances')
    await expect(fetchAllFinancialEventGroups(35)).rejects.toThrow('SP-API rate limited')
  })

  it('returns non-CAD groups without filtering — caller is responsible for currency filter', async () => {
    mockSpFetch.mockResolvedValueOnce(
      makeApiResponse([makeGroup('FEG-CAD', 'CAD'), makeGroup('FEG-MXN', 'MXN')])
    )

    const { fetchAllFinancialEventGroups } = await import('@/lib/amazon/finances')
    const result = await fetchAllFinancialEventGroups(35)

    expect(result).toHaveLength(2)
    expect(result.find((g) => g.FinancialEventGroupId === 'FEG-MXN')).toBeDefined()
  })
})
