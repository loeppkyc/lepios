import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock knowledge client so logEvent doesn't attempt a real Supabase write.
vi.mock('@/lib/knowledge/client', () => ({
  logEvent: vi.fn().mockResolvedValue(null),
  logError: vi.fn().mockResolvedValue(null),
  logSuccess: vi.fn().mockResolvedValue(null),
}))

const FAKE_ENV: Record<string, string> = {
  AMAZON_SP_REFRESH_TOKEN: 'fake-refresh-token',
  AMAZON_SP_CLIENT_ID: 'fake-client-id',
  AMAZON_SP_CLIENT_SECRET: 'fake-client-secret',
  AMAZON_AWS_ACCESS_KEY: 'AKIAFAKE12345678',
  AMAZON_AWS_SECRET_KEY: 'fakesecretkey123456789012345678901234567',
}

describe('spFetch — 429 retry', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(FAKE_ENV)) process.env[k] = v
    // Reset module state (clears LWA token cache) so each test starts clean.
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries on 429 + Retry-After header, succeeds on second SP-API call', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    // Call 1 — LWA token exchange
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    // Call 2 — SP-API returns 429 with Retry-After: 0 (instant retry in test)
    mockFetch.mockResolvedValueOnce(
      new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '0' },
      })
    )
    // Call 3 — SP-API success (LWA token still cached; no second token call)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ payload: { Orders: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    // Dynamic import after resetModules to get clean module state.
    const { spFetch } = await import('@/lib/amazon/client')
    const result = await spFetch('/orders/v0/orders', {
      params: { MarketplaceIds: 'A2EUQ1WTGCTBG2' },
    })

    expect(result).toEqual({ payload: { Orders: [] } })
    // 1 LWA exchange + 1 rejected 429 + 1 successful retry = 3 fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(3)

    const { logEvent } = await import('@/lib/knowledge/client')
    // logEvent called once for the 429 retry
    expect(vi.mocked(logEvent)).toHaveBeenCalledOnce()
    expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
      'amazon',
      'sp_api.429_retry',
      expect.objectContaining({
        actor: 'system',
        status: 'warning',
        meta: expect.objectContaining({ attempt: 1, retryAfter: '0' }),
      })
    )
  })
})

describe('spFetch — 5xx retry', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(FAKE_ENV)) process.env[k] = v
    vi.resetModules()
    // Clear logEvent call history so per-test count assertions don't see
    // accumulated calls from earlier tests in this file.
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries on 500 InternalFailure, succeeds on second SP-API call', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    // Call 1 — LWA token exchange
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    // Call 2 — SP-API returns 500 InternalFailure (Amazon-transient)
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [
            {
              code: 'InternalFailure',
              message: 'We encountered an internal error. Please try again.',
              details: '',
            },
          ],
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    )
    // Call 3 — SP-API success
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ payload: { Orders: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const { spFetch } = await import('@/lib/amazon/client')
    const result = await spFetch('/orders/v0/orders', {
      params: { MarketplaceIds: 'A2EUQ1WTGCTBG2' },
    })

    expect(result).toEqual({ payload: { Orders: [] } })
    expect(mockFetch).toHaveBeenCalledTimes(3)

    const { logEvent } = await import('@/lib/knowledge/client')
    expect(vi.mocked(logEvent)).toHaveBeenCalledOnce()
    expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
      'amazon',
      'sp_api.5xx_retry',
      expect.objectContaining({
        actor: 'system',
        status: 'warning',
        meta: expect.objectContaining({ status: 500, attempt: 1 }),
      })
    )
  })

  it('retries on 503 Service Unavailable too', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    mockFetch.mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ payload: { Orders: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const { spFetch } = await import('@/lib/amazon/client')
    const result = await spFetch('/orders/v0/orders', {
      params: { MarketplaceIds: 'A2EUQ1WTGCTBG2' },
    })

    expect(result).toEqual({ payload: { Orders: [] } })
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('throws after MAX_RETRIES of 500s', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    // LWA exchange
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    // 6 consecutive 500s (MAX_RETRIES=5 → 6 attempts total)
    for (let i = 0; i < 6; i++) {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ code: 'InternalFailure' }] }), { status: 500 })
      )
    }

    const { spFetch } = await import('@/lib/amazon/client')
    await expect(
      spFetch('/orders/v0/orders', { params: { MarketplaceIds: 'A2EUQ1WTGCTBG2' } })
    ).rejects.toThrow(/upstream error after 5 retries/)
  }, 60_000)

  it('does NOT retry on 4xx (other than 429) — propagates immediately', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    // 400 Bad Request — should NOT be retried
    mockFetch.mockResolvedValueOnce(
      new Response('CreatedBefore must be a date in the past', { status: 400 })
    )

    const { spFetch } = await import('@/lib/amazon/client')
    await expect(
      spFetch('/orders/v0/orders', { params: { MarketplaceIds: 'A2EUQ1WTGCTBG2' } })
    ).rejects.toThrow(/SP-API GET .* \(400\)/)

    // Exactly 2 calls — LWA exchange + the single 400. No retry.
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
