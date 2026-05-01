import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetBsrHistory, mockGetUser, mockLogError, mockLogEvent } = vi.hoisted(() => ({
  mockGetBsrHistory: vi.fn(),
  mockGetUser: vi.fn(),
  mockLogError: vi.fn().mockResolvedValue(null),
  mockLogEvent: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}))

vi.mock('@/lib/keepa/history', () => ({
  getBsrHistory: mockGetBsrHistory,
  KeepaNetworkError: class KeepaNetworkError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'KeepaNetworkError'
    }
  },
  KeepaHttpError: class KeepaHttpError extends Error {
    status: number
    asin: string
    constructor(status: number, asin: string) {
      super(`Keepa returned HTTP ${status} for ASIN ${asin}`)
      this.name = 'KeepaHttpError'
      this.status = status
      this.asin = asin
    }
  },
  KeepaParseError: class KeepaParseError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'KeepaParseError'
    }
  },
}))

vi.mock('@/lib/knowledge/client', () => ({
  logError: mockLogError,
  logEvent: mockLogEvent,
}))

import { GET } from '@/app/api/bsr-history/route'

const ASIN = 'B0TEST12345'

function makeRequest(asin = ASIN) {
  return new Request(`http://localhost/api/bsr-history?asin=${asin}`)
}

function makeSuccessResult() {
  return {
    asin: ASIN,
    points: [{ t: 1700000000, rank: 50000 }],
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    tokensLeft: 900,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
})

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('GET /api/bsr-history — auth', () => {
  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 400 when asin param is missing', async () => {
    const res = await GET(new Request('http://localhost/api/bsr-history'))
    expect(res.status).toBe(400)
  })
})

// ── Keepa errors → 500 ───────────────────────────────────────────────────────

describe('GET /api/bsr-history — KeepaNetworkError → 500', () => {
  it('returns 500', async () => {
    mockGetBsrHistory.mockRejectedValue(new Error('connection refused'))
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })

  it('returns error body', async () => {
    mockGetBsrHistory.mockRejectedValue(new Error('connection refused'))
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.error).toBe('Failed to fetch BSR history')
  })

  it('calls logError with pageprofit domain', async () => {
    mockGetBsrHistory.mockRejectedValue(new Error('connection refused'))
    await GET(makeRequest())
    expect(mockLogError).toHaveBeenCalledWith(
      'pageprofit',
      'bsr_sparkline',
      expect.any(Error),
      expect.objectContaining({ actor: 'user', entity: ASIN }),
    )
  })
})

describe('GET /api/bsr-history — KeepaHttpError → 500', () => {
  it('returns 500', async () => {
    mockGetBsrHistory.mockRejectedValue(new Error('Keepa returned HTTP 429'))
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })

  it('calls logError', async () => {
    mockGetBsrHistory.mockRejectedValue(new Error('Keepa returned HTTP 429'))
    await GET(makeRequest())
    expect(mockLogError).toHaveBeenCalledOnce()
  })
})

describe('GET /api/bsr-history — KeepaParseError → 500', () => {
  it('returns 500', async () => {
    mockGetBsrHistory.mockRejectedValue(new Error('Unexpected token'))
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })

  it('calls logError', async () => {
    mockGetBsrHistory.mockRejectedValue(new Error('Unexpected token'))
    await GET(makeRequest())
    expect(mockLogError).toHaveBeenCalledOnce()
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('GET /api/bsr-history — success', () => {
  it('returns 200 on success', async () => {
    mockGetBsrHistory.mockResolvedValue(makeSuccessResult())
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })

  it('does not call logError on success', async () => {
    mockGetBsrHistory.mockResolvedValue(makeSuccessResult())
    await GET(makeRequest())
    expect(mockLogError).not.toHaveBeenCalled()
  })

  it('calls logEvent on cache-miss with tokensLeft', async () => {
    mockGetBsrHistory.mockResolvedValue(makeSuccessResult())
    await GET(makeRequest())
    expect(mockLogEvent).toHaveBeenCalledWith(
      'pageprofit',
      'bsr_sparkline',
      expect.objectContaining({ meta: expect.objectContaining({ keepa_tokens_left: 900 }) }),
    )
  })

  it('does not call logEvent on cache hit', async () => {
    mockGetBsrHistory.mockResolvedValue({ ...makeSuccessResult(), fromCache: true, tokensLeft: null })
    await GET(makeRequest())
    expect(mockLogEvent).not.toHaveBeenCalled()
  })
})
