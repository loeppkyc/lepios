import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

import { getBsrHistory, KeepaNetworkError, KeepaHttpError, KeepaParseError } from '@/lib/keepa/history'

const ASIN = 'B0TEST12345'
const VALID_KEY = 'test-keepa-key'

function makeCacheMissClient() {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }
}

function makeCacheHitClient() {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { points: [{ t: 1700000000, rank: 50000 }], fetched_at: '2026-01-01T00:00:00.000Z' },
      }),
    }),
  }
}

beforeEach(() => {
  process.env.KEEPA_API_KEY = VALID_KEY
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  delete process.env.KEEPA_API_KEY
})

// ── Network error ─────────────────────────────────────────────────────────────

describe('getBsrHistory — network error', () => {
  it('throws KeepaNetworkError when fetch rejects', async () => {
    mockCreateClient.mockResolvedValue(makeCacheMissClient())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    await expect(getBsrHistory(ASIN)).rejects.toThrow(KeepaNetworkError)
  })

  it('KeepaNetworkError.name is KeepaNetworkError', async () => {
    mockCreateClient.mockResolvedValue(makeCacheMissClient())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const err = await getBsrHistory(ASIN).catch((e: unknown) => e)
    expect((err as KeepaNetworkError).name).toBe('KeepaNetworkError')
  })

  it('KeepaNetworkError message carries original error message', async () => {
    mockCreateClient.mockResolvedValue(makeCacheMissClient())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    const err = await getBsrHistory(ASIN).catch((e: unknown) => e)
    expect((err as KeepaNetworkError).message).toBe('connection refused')
  })
})

// ── HTTP error ────────────────────────────────────────────────────────────────

describe('getBsrHistory — HTTP error', () => {
  it('throws KeepaHttpError on 429', async () => {
    mockCreateClient.mockResolvedValue(makeCacheMissClient())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    await expect(getBsrHistory(ASIN)).rejects.toThrow(KeepaHttpError)
  })

  it('throws KeepaHttpError on 500', async () => {
    mockCreateClient.mockResolvedValue(makeCacheMissClient())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(getBsrHistory(ASIN)).rejects.toThrow(KeepaHttpError)
  })

  it('KeepaHttpError carries status and asin', async () => {
    mockCreateClient.mockResolvedValue(makeCacheMissClient())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    const err = await getBsrHistory(ASIN).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(KeepaHttpError)
    expect((err as KeepaHttpError).status).toBe(429)
    expect((err as KeepaHttpError).asin).toBe(ASIN)
  })
})

// ── JSON parse error ──────────────────────────────────────────────────────────

describe('getBsrHistory — JSON parse error', () => {
  it('throws KeepaParseError when response body is malformed', async () => {
    mockCreateClient.mockResolvedValue(makeCacheMissClient())
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON')),
      }),
    )
    await expect(getBsrHistory(ASIN)).rejects.toThrow(KeepaParseError)
  })

  it('KeepaParseError.name is KeepaParseError', async () => {
    mockCreateClient.mockResolvedValue(makeCacheMissClient())
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError('bad json')),
      }),
    )
    const err = await getBsrHistory(ASIN).catch((e: unknown) => e)
    expect((err as KeepaParseError).name).toBe('KeepaParseError')
  })
})

// ── Missing API key — silent return ──────────────────────────────────────────

describe('getBsrHistory — missing API key', () => {
  it('returns empty points without throwing when KEEPA_API_KEY is absent', async () => {
    delete process.env.KEEPA_API_KEY
    mockCreateClient.mockResolvedValue(makeCacheMissClient())
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const result = await getBsrHistory(ASIN)
    expect(result.points).toEqual([])
    expect(result.tokensLeft).toBeNull()
  })

  it('does not call fetch when KEEPA_API_KEY is absent', async () => {
    delete process.env.KEEPA_API_KEY
    mockCreateClient.mockResolvedValue(makeCacheMissClient())
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    await getBsrHistory(ASIN)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── Cache hit ─────────────────────────────────────────────────────────────────

describe('getBsrHistory — cache hit', () => {
  it('returns fromCache:true on a cache hit', async () => {
    mockCreateClient.mockResolvedValue(makeCacheHitClient())
    vi.stubGlobal('fetch', vi.fn())
    const result = await getBsrHistory(ASIN)
    expect(result.fromCache).toBe(true)
  })

  it('does not call fetch on a cache hit', async () => {
    mockCreateClient.mockResolvedValue(makeCacheHitClient())
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    await getBsrHistory(ASIN)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns cached points on a cache hit', async () => {
    mockCreateClient.mockResolvedValue(makeCacheHitClient())
    vi.stubGlobal('fetch', vi.fn())
    const result = await getBsrHistory(ASIN)
    expect(result.points).toEqual([{ t: 1700000000, rank: 50000 }])
  })
})
