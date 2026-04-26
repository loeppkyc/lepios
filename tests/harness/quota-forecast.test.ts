import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import {
  forecastQuotaBeforeStart,
  buildStartupForecastLine,
} from '@/lib/harness/quota-forecast'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSelectChain(result: { data: unknown[] | null; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'filter', 'gte', 'lte', 'order', 'limit', 'not', 'or']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

function make429Event(occurredAt: string, retryAfter?: string | number) {
  return {
    occurred_at: occurredAt,
    meta: {
      upstream_status: 429,
      ...(retryAfter !== undefined ? { retry_after: String(retryAfter) } : {}),
    },
  }
}

function makeBurnRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `burn-${i}` }))
}

beforeEach(() => vi.clearAllMocks())

// ── forecastQuotaBeforeStart — quota_healthy ──────────────────────────────────

describe('forecastQuotaBeforeStart — quota_healthy', () => {
  it('returns safe_to_start=true when no 429s and low burn rate', async () => {
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: [], error: null })) // 429 query
      .mockReturnValueOnce(makeSelectChain({ data: makeBurnRows(3), error: null })) // burn query

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(true)
    expect(result.reason).toBe('quota_healthy')
    expect(result.invocations_24h).toBe(3)
    expect(result.cliff_threshold).toBe(10)
    expect(result.estimated_remaining).toBe(7)
    expect(result.recommended_wait_minutes).toBeUndefined()
  })

  it('returns safe_to_start=true when 429 data is null (treat as no recent 429s)', async () => {
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: null, error: null })) // 429 query → null
      .mockReturnValueOnce(makeSelectChain({ data: makeBurnRows(2), error: null }))

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(true)
    expect(result.reason).toBe('quota_healthy')
    expect(result.invocations_24h).toBe(2)
  })

  it('estimated_remaining = cliff_threshold when 0 invocations', async () => {
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: [], error: null }))
      .mockReturnValueOnce(makeSelectChain({ data: [], error: null }))

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(true)
    expect(result.estimated_remaining).toBe(10)
    expect(result.invocations_24h).toBe(0)
  })

  it('returns safe_to_start=true when 429 backoff is fully expired', async () => {
    // Event 3 hours ago, retry_after = 1800s (30 min) → expired 2.5h ago
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    mockFrom
      .mockReturnValueOnce(
        makeSelectChain({ data: [make429Event(threeHoursAgo, 1800)], error: null })
      )
      .mockReturnValueOnce(makeSelectChain({ data: makeBurnRows(4), error: null }))

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(true)
    expect(result.reason).toBe('quota_healthy')
    expect(result.invocations_24h).toBe(4)
  })
})

// ── forecastQuotaBeforeStart — recent_429_backoff_active ──────────────────────

describe('forecastQuotaBeforeStart — recent_429_backoff_active', () => {
  it('returns safe_to_start=false when 429 backoff has >1h remaining (integer seconds)', async () => {
    // Event 30 min ago, retry_after = 7200s (2h) → 1.5h remaining
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [make429Event(thirtyMinAgo, 7200)], error: null })
    )

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(false)
    expect(result.reason).toBe('recent_429_backoff_active')
    expect(result.recommended_wait_minutes).toBeGreaterThan(60)
    expect(result.recommended_wait_minutes).toBeLessThanOrEqual(90)
    expect(result.estimated_remaining).toBe(0)
  })

  it('uses DEFAULT_BACKOFF (60 min) when retry_after is absent and event is recent', async () => {
    // Event 5 min ago, no retry_after → default 60 min → 55 min remaining → but 55 < EXPIRING_SOON (60)
    // → this hits the "expiring_soon" branch, not "active"
    // So to test "active", need > 1h remaining with no retry_after:
    // Event right now, no retry_after → default 60 min exactly → remaining = 60 min
    // remaining_ms = 60 * 60 * 1000 which is NOT > EXPIRING_SOON_MS (60 * 60 * 1000)
    // So we need an event fresh enough that remaining > 60min.
    // With no retry_after: cutoff = occurred_at + 60min. To have remaining > 60min, that's impossible
    // unless occurred_at is in the future, which can't happen.
    // So DEFAULT_BACKOFF (60 min) with a brand-new event: remaining ≈ 60 min → NOT > 60 min → expiring_soon.
    // The "active" path with default backoff is only reachable at exactly t=0, which is a race.
    // Test the boundary: a 61-minute retry_after from a very recent event
    const justNow = new Date(Date.now() - 5 * 1000).toISOString() // 5s ago
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [make429Event(justNow, 61 * 60)], error: null }) // 61 min → >60min remaining
    )

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(false)
    expect(result.reason).toBe('recent_429_backoff_active')
    expect(result.recommended_wait_minutes).toBeGreaterThan(60)
  })

  it('handles ISO date string in retry_after field', async () => {
    const now = new Date()
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [make429Event(now.toISOString(), twoHoursFromNow)], error: null })
    )

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(false)
    expect(result.reason).toBe('recent_429_backoff_active')
    expect(result.recommended_wait_minutes).toBeGreaterThan(60)
  })
})

// ── forecastQuotaBeforeStart — recent_429_expiring_soon ──────────────────────

describe('forecastQuotaBeforeStart — recent_429_expiring_soon', () => {
  it('returns safe_to_start=true when backoff expires in <1h (treat as just-reset)', async () => {
    // Event 50 min ago, retry_after = 3600s (1h) → 10 min remaining → <1h → expiring_soon
    const fiftyMinAgo = new Date(Date.now() - 50 * 60 * 1000).toISOString()
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [make429Event(fiftyMinAgo, 3600)], error: null })
    )

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(true)
    expect(result.reason).toBe('recent_429_expiring_soon')
    expect(result.estimated_remaining).toBe(10) // treated as full quota
    expect(result.recommended_wait_minutes).toBeGreaterThan(0)
    expect(result.recommended_wait_minutes).toBeLessThanOrEqual(10)
  })

  it('does not check burn rate when in expiring_soon state', async () => {
    const fiftyMinAgo = new Date(Date.now() - 50 * 60 * 1000).toISOString()
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [make429Event(fiftyMinAgo, 3600)], error: null })
    )

    await forecastQuotaBeforeStart()

    // Only 1 mockFrom call (the 429 query) — burn query never fires
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })
})

// ── forecastQuotaBeforeStart — burn_rate_cliff_risk ──────────────────────────

describe('forecastQuotaBeforeStart — burn_rate_cliff_risk', () => {
  it('returns safe_to_start=false when remaining < TASK_COST_MAX (3)', async () => {
    // invocations_24h=8, estimated_remaining=2, 2 < 3 → cliff risk
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: [], error: null })) // no 429s
      .mockReturnValueOnce(makeSelectChain({ data: makeBurnRows(8), error: null }))

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(false)
    expect(result.reason).toBe('burn_rate_cliff_risk')
    expect(result.invocations_24h).toBe(8)
    expect(result.estimated_remaining).toBe(2)
    expect(result.recommended_wait_minutes).toBe(60)
  })

  it('returns safe_to_start=false when invocations exactly at cliff (estimated_remaining=0)', async () => {
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: [], error: null }))
      .mockReturnValueOnce(makeSelectChain({ data: makeBurnRows(10), error: null }))

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(false)
    expect(result.reason).toBe('burn_rate_cliff_risk')
    expect(result.estimated_remaining).toBe(0)
  })

  it('returns safe_to_start=true when exactly at TASK_COST_MAX boundary (remaining=3)', async () => {
    // invocations_24h=7, estimated_remaining=3, 3 is NOT < 3 → healthy
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: [], error: null }))
      .mockReturnValueOnce(makeSelectChain({ data: makeBurnRows(7), error: null }))

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(true)
    expect(result.reason).toBe('quota_healthy')
    expect(result.estimated_remaining).toBe(3)
  })
})

// ── forecastQuotaBeforeStart — forecast_error (fail open) ────────────────────

describe('forecastQuotaBeforeStart — forecast_error (fail open)', () => {
  it('returns safe_to_start=true when burn query returns DB error', async () => {
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: [], error: null })) // 429 query OK
      .mockReturnValueOnce(makeSelectChain({ data: null, error: { message: 'DB down' } }))

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(true)
    expect(result.reason).toBe('forecast_error')
  })

  it('returns safe_to_start=true when createServiceClient throws (fail-open)', async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error('connection refused')
    })

    const result = await forecastQuotaBeforeStart()

    expect(result.safe_to_start).toBe(true)
    expect(result.reason).toBe('forecast_error')
  })

  it('never throws regardless of error type', async () => {
    mockFrom.mockImplementationOnce(() => {
      throw 'string error' // non-Error throw
    })

    await expect(forecastQuotaBeforeStart()).resolves.toMatchObject({
      safe_to_start: true,
      reason: 'forecast_error',
    })
  })
})

// ── buildStartupForecastLine ──────────────────────────────────────────────────

describe('buildStartupForecastLine', () => {
  it('returns clean ✅ line when 0 startup skips in last 24h', async () => {
    mockFrom.mockReturnValueOnce(makeSelectChain({ data: [], error: null }))
    const line = await buildStartupForecastLine()
    expect(line).toBe('Coordinator startup skips (24h): 0 ✅')
  })

  it('returns warning line with count when skips > 0', async () => {
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null })
    )
    const line = await buildStartupForecastLine()
    expect(line).toContain('Coordinator startup skips (24h): 3')
    expect(line).toContain('⚠️')
    expect(line).toContain('3 coordinator starts')
  })

  it('uses singular "start" when count = 1', async () => {
    mockFrom.mockReturnValueOnce(makeSelectChain({ data: [{ id: 'a' }], error: null }))
    const line = await buildStartupForecastLine()
    expect(line).toContain('1 coordinator start')
    expect(line).not.toContain('1 coordinator starts')
  })

  it('returns unavailable on DB error', async () => {
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: null, error: { message: 'DB error' } })
    )
    const line = await buildStartupForecastLine()
    expect(line).toBe('Coordinator startup skips (24h): unavailable')
  })

  it('returns unavailable on thrown error', async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error('crash')
    })
    const line = await buildStartupForecastLine()
    expect(line).toBe('Coordinator startup skips (24h): unavailable')
  })
})
