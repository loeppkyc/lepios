/**
 * Acceptance tests for GET /api/scan/history
 *
 * Mocks @/lib/supabase/server so next/headers is never imported in the
 * test environment. The mock exposes getUser() and from() as vi.fn()s that
 * each test configures independently.
 *
 * Column under test: recorded_at (actual column name — listed_at does not exist).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase server client ───────────────────────────────────────────────

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}))

// ── Route import (after mock declaration) ────────────────────────────────────

import { GET } from '@/app/api/scan/history/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockUser = { id: 'user-123', email: 'colin@example.com' }

const mockScanRows = [
  {
    id: 'scan-1',
    isbn: '9780307888037',
    asin: 'B00ABCDEF1',
    title: 'The Power of Habit',
    buy_box_price_cad: 14.5,
    profit_cad: 5.25,
    roi_pct: 210.0,
    decision: 'buy',
    cost_paid_cad: 0.25,
    bsr: 15000,
    tier: 'STANDARD',
    recorded_at: '2026-05-10T22:42:00Z',
  },
  {
    id: 'scan-2',
    isbn: '9780062316097',
    asin: 'B00ABCDEF2',
    title: 'Sapiens',
    buy_box_price_cad: 8.0,
    profit_cad: 1.5,
    roi_pct: 600.0,
    decision: 'skip',
    cost_paid_cad: 0.25,
    bsr: 80000,
    tier: 'STANDARD',
    recorded_at: '2026-05-10T20:00:00Z',
  },
]

// ── Query builder factory ─────────────────────────────────────────────────────

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  }
  return builder
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
})

// ── Auth: unauthenticated → 401 ───────────────────────────────────────────────

describe('GET /api/scan/history — unauthenticated', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
  })

  it('returns 401 when no session', async () => {
    const res = await GET(new Request('http://localhost/api/scan/history'))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })
})

// ── GET — authenticated ───────────────────────────────────────────────────────

describe('GET /api/scan/history — authenticated', () => {
  it('returns array of scan rows for valid session', async () => {
    const builder = makeQueryBuilder({ data: mockScanRows, error: null })
    mockFrom.mockReturnValue(builder)

    const res = await GET(new Request('http://localhost/api/scan/history'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json)).toBe(true)
    expect(json).toHaveLength(2)
    expect(json[0].id).toBe('scan-1')
    expect(json[0].decision).toBe('buy')
  })

  it('returns empty array when no scans exist', async () => {
    const builder = makeQueryBuilder({ data: [], error: null })
    mockFrom.mockReturnValue(builder)

    const res = await GET(new Request('http://localhost/api/scan/history'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json)).toBe(true)
    expect(json).toHaveLength(0)
  })

  it('returns 500 when Supabase returns an error', async () => {
    const builder = makeQueryBuilder({ data: null, error: { message: 'db error' } })
    mockFrom.mockReturnValue(builder)

    const res = await GET(new Request('http://localhost/api/scan/history'))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })
})

// ── GET — decision filter ─────────────────────────────────────────────────────

describe('GET /api/scan/history — decision filter', () => {
  it('passes decision=buy as eq filter to Supabase', async () => {
    const builder = makeQueryBuilder({ data: [mockScanRows[0]], error: null })
    mockFrom.mockReturnValue(builder)

    const res = await GET(new Request('http://localhost/api/scan/history?decision=buy'))
    expect(res.status).toBe(200)

    // eq should be called twice: once for person_handle, once for decision
    const eqCalls = builder.eq.mock.calls
    const decisionCall = eqCalls.find((call) => call[0] === 'decision')
    expect(decisionCall).toBeDefined()
    expect(decisionCall?.[1]).toBe('buy')
  })

  it('passes decision=skip as eq filter to Supabase', async () => {
    const builder = makeQueryBuilder({ data: [mockScanRows[1]], error: null })
    mockFrom.mockReturnValue(builder)

    await GET(new Request('http://localhost/api/scan/history?decision=skip'))

    const eqCalls = builder.eq.mock.calls
    const decisionCall = eqCalls.find((call) => call[0] === 'decision')
    expect(decisionCall).toBeDefined()
    expect(decisionCall?.[1]).toBe('skip')
  })

  it('does NOT add decision eq filter when decision=all', async () => {
    const builder = makeQueryBuilder({ data: mockScanRows, error: null })
    mockFrom.mockReturnValue(builder)

    await GET(new Request('http://localhost/api/scan/history?decision=all'))

    const eqCalls = builder.eq.mock.calls
    const decisionCall = eqCalls.find((call) => call[0] === 'decision')
    expect(decisionCall).toBeUndefined()
  })

  it('treats unknown decision value as "all" — no decision eq filter', async () => {
    const builder = makeQueryBuilder({ data: mockScanRows, error: null })
    mockFrom.mockReturnValue(builder)

    await GET(new Request('http://localhost/api/scan/history?decision=invalid'))

    const eqCalls = builder.eq.mock.calls
    const decisionCall = eqCalls.find((call) => call[0] === 'decision')
    expect(decisionCall).toBeUndefined()
  })

  it('defaults to limit 100 when no limit param provided', async () => {
    const builder = makeQueryBuilder({ data: mockScanRows, error: null })
    mockFrom.mockReturnValue(builder)

    await GET(new Request('http://localhost/api/scan/history'))
    expect(builder.limit).toHaveBeenCalledWith(100)
  })

  it('caps limit at 100 even when a larger value is requested', async () => {
    const builder = makeQueryBuilder({ data: mockScanRows, error: null })
    mockFrom.mockReturnValue(builder)

    await GET(new Request('http://localhost/api/scan/history?limit=9999'))
    expect(builder.limit).toHaveBeenCalledWith(100)
  })
})
