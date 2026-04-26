import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { preClaimQuotaCheck, buildQuotaGuardLine } from '@/lib/harness/quota-guard'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSelectChain(result: { data: unknown[] | null; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'filter', 'gte', 'lte', 'order', 'limit', 'not', 'or']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

function makeInsertChain() {
  return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
}

// Build an event row with occurred_at and optional retry_after in meta
function makeEvent(occurred_at: string, retry_after?: string | number) {
  return {
    occurred_at,
    meta: {
      upstream_status: 429,
      ...(retry_after !== undefined ? { retry_after: String(retry_after) } : {}),
    },
  }
}

beforeEach(() => vi.clearAllMocks())

// ── preClaimQuotaCheck ────────────────────────────────────────────────────────

describe('preClaimQuotaCheck — no recent 429s', () => {
  it('returns safe_to_claim=true when no 429 events in last 6h', async () => {
    mockFrom.mockReturnValueOnce(makeSelectChain({ data: [], error: null }))
    const result = await preClaimQuotaCheck()
    expect(result.safe_to_claim).toBe(true)
    expect(result.reason).toBe('no_recent_429s')
  })

  it('returns safe_to_claim=true when data is null (empty result)', async () => {
    mockFrom.mockReturnValueOnce(makeSelectChain({ data: null, error: null }))
    const result = await preClaimQuotaCheck()
    expect(result.safe_to_claim).toBe(true)
    expect(result.reason).toBe('no_recent_429s')
  })

  it('returns safe_to_claim=true when DB errors (fail-open guard)', async () => {
    mockFrom.mockReturnValueOnce(makeSelectChain({ data: null, error: { message: 'DB down' } }))
    const result = await preClaimQuotaCheck()
    expect(result.safe_to_claim).toBe(true)
    expect(result.reason).toBe('guard_error')
  })

  it('returns safe_to_claim=true when guard throws (fail-open)', async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error('unexpected crash')
    })
    const result = await preClaimQuotaCheck()
    expect(result.safe_to_claim).toBe(true)
    expect(result.reason).toBe('guard_error')
  })
})

describe('preClaimQuotaCheck — recent 429 with backoff still active', () => {
  it('returns safe_to_claim=false when retry_after is in the future (integer seconds)', async () => {
    // Event 2 minutes ago with 30-minute retry-after
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [makeEvent(twoMinutesAgo, 1800)], error: null }) // 30 min = 1800s
    )
    const result = await preClaimQuotaCheck()
    expect(result.safe_to_claim).toBe(false)
    expect(result.reason).toBe('quota_429_backoff_active')
    // Should be ~28 minutes remaining (30 - 2 already elapsed)
    expect(result.retry_after_minutes).toBeGreaterThan(0)
    expect(result.retry_after_minutes).toBeLessThanOrEqual(30)
  })

  it('retry_after_minutes is rounded up (ceil)', async () => {
    // Event 1 minute ago with 2-minute retry-after → ~1 min remaining, ceil = 1
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString()
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [makeEvent(oneMinuteAgo, 120)], error: null }) // 2 min = 120s
    )
    const result = await preClaimQuotaCheck()
    expect(result.safe_to_claim).toBe(false)
    expect(result.retry_after_minutes).toBeGreaterThanOrEqual(1)
  })

  it('uses DEFAULT_BACKOFF (60 min) when retry_after is absent and event is recent', async () => {
    // Event 5 minutes ago with no retry_after — default 60 min → 55 min remaining
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [makeEvent(fiveMinutesAgo)], error: null })
    )
    const result = await preClaimQuotaCheck()
    expect(result.safe_to_claim).toBe(false)
    expect(result.reason).toBe('quota_429_backoff_active')
    expect(result.retry_after_minutes).toBeGreaterThan(50)
    expect(result.retry_after_minutes).toBeLessThanOrEqual(60)
  })

  it('handles HTTP-date format in retry_after', async () => {
    // Event right now, retry_after = HTTP-date 30 minutes from now
    const now = new Date().toISOString()
    const futureDate = new Date(Date.now() + 30 * 60 * 1000).toUTCString() // HTTP-date format
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [makeEvent(now, futureDate)], error: null })
    )
    const result = await preClaimQuotaCheck()
    expect(result.safe_to_claim).toBe(false)
    expect(result.retry_after_minutes).toBeGreaterThan(25)
    expect(result.retry_after_minutes).toBeLessThanOrEqual(30)
  })
})

describe('preClaimQuotaCheck — recent 429 with backoff expired', () => {
  it('returns safe_to_claim=true when retry_after is in the past', async () => {
    // Event 2 hours ago with 30-minute retry-after → expired
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [makeEvent(twoHoursAgo, 1800)], error: null }) // 30 min
    )
    const result = await preClaimQuotaCheck()
    expect(result.safe_to_claim).toBe(true)
    expect(result.reason).toBe('quota_429_backoff_expired')
    expect(result.retry_after_minutes).toBeUndefined()
  })

  it('backoff expired: default 60 min, event 90 min ago → safe', async () => {
    const ninetyMinutesAgo = new Date(Date.now() - 90 * 60 * 1000).toISOString()
    mockFrom.mockReturnValueOnce(
      makeSelectChain({ data: [makeEvent(ninetyMinutesAgo)], error: null })
    )
    const result = await preClaimQuotaCheck()
    expect(result.safe_to_claim).toBe(true)
    expect(result.reason).toBe('quota_429_backoff_expired')
  })
})

// ── buildQuotaGuardLine ───────────────────────────────────────────────────────

describe('buildQuotaGuardLine', () => {
  it('returns clean ✅ line when 0 guard skips in last 24h', async () => {
    mockFrom.mockReturnValueOnce(makeSelectChain({ data: [], error: null }))
    const line = await buildQuotaGuardLine()
    expect(line).toBe('Quota guard skips (24h): 0 ✅')
  })

  it('returns warning line with count when skips > 0', async () => {
    mockFrom.mockReturnValueOnce(makeSelectChain({ data: [{ id: 'a' }, { id: 'b' }], error: null }))
    const line = await buildQuotaGuardLine()
    expect(line).toContain('Quota guard skips (24h): 2')
    expect(line).toContain('⚠️')
    expect(line).toContain('2 pickups')
  })

  it('uses singular "pickup" when count = 1', async () => {
    mockFrom.mockReturnValueOnce(makeSelectChain({ data: [{ id: 'a' }], error: null }))
    const line = await buildQuotaGuardLine()
    expect(line).toContain('1 pickup')
    expect(line).not.toContain('1 pickups')
  })

  it('returns unavailable on DB error', async () => {
    mockFrom.mockReturnValueOnce(makeSelectChain({ data: null, error: { message: 'DB error' } }))
    const line = await buildQuotaGuardLine()
    expect(line).toBe('Quota guard skips (24h): unavailable')
  })

  it('returns unavailable on thrown error', async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error('crash')
    })
    const line = await buildQuotaGuardLine()
    expect(line).toBe('Quota guard skips (24h): unavailable')
  })
})
