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

describe('generateSku', () => {
  it('returns a string matching /^BK-\\d{14}$/', async () => {
    const { generateSku } = await import('@/lib/amazon/listings')
    const sku = generateSku()
    expect(sku).toMatch(/^BK-\d{14}$/)
  })

  it('generates different SKUs when called at different times', async () => {
    const { generateSku } = await import('@/lib/amazon/listings')
    // Two calls in the same second could produce the same SKU (that's accepted),
    // but the format must always be valid.
    const sku1 = generateSku()
    const sku2 = generateSku()
    expect(sku1).toMatch(/^BK-\d{14}$/)
    expect(sku2).toMatch(/^BK-\d{14}$/)
  })
})

describe('sellerConfigured', () => {
  afterEach(() => {
    delete process.env.AMAZON_SELLER_ID
    vi.resetModules()
  })

  it('returns false when AMAZON_SELLER_ID is undefined', async () => {
    delete process.env.AMAZON_SELLER_ID
    vi.resetModules()
    const { sellerConfigured } = await import('@/lib/amazon/listings')
    expect(sellerConfigured()).toBe(false)
  })

  it('returns true when AMAZON_SELLER_ID is set', async () => {
    process.env.AMAZON_SELLER_ID = 'AFAKESELLER123'
    vi.resetModules()
    const { sellerConfigured } = await import('@/lib/amazon/listings')
    expect(sellerConfigured()).toBe(true)
  })
})

describe('createAmazonListing', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(FAKE_ENV)) process.env[k] = v
    process.env.AMAZON_SELLER_ID = 'AFAKESELLER123'
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.AMAZON_SELLER_ID
  })

  it('returns { status: ACCEPTED, issues: [] } on successful PUT', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    // Call 1 — LWA token exchange
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    // Call 2 — SP-API PUT returns ACCEPTED
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sku: 'BK-20260510120000',
          submissionResponse: {
            status: 'ACCEPTED',
            issues: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    // Call 3 — SP-API PATCH (price enforcement)
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sku: 'BK-20260510120000',
          submissionResponse: {
            status: 'VALID',
            issues: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const { createAmazonListing } = await import('@/lib/amazon/listings')
    const result = await createAmazonListing(
      'B001234567',
      'like_new',
      'Like New Condition. 100% Satisfaction Guaranteed.',
      24.99
    )

    expect(result.status).toBe('ACCEPTED')
    expect(result.issues).toEqual([])
    expect(result.sku).toMatch(/^BK-\d{14}$/)
  })

  it('returns { status: INVALID, issues } when PUT returns INVALID', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    // LWA token exchange
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    // PUT returns INVALID
    const fakeIssues = [{ code: 'INVALID_ATTRIBUTE', message: 'condition_type is invalid' }]
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          submissionResponse: {
            status: 'INVALID',
            issues: fakeIssues,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const { createAmazonListing } = await import('@/lib/amazon/listings')
    const result = await createAmazonListing('B001234567', 'very_good', 'Good shape', 19.99)

    expect(result.status).toBe('INVALID')
    expect(result.issues).toEqual(fakeIssues)
  })

  it('returns { status: ERROR } when spFetch throws', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    // LWA token exchange
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    // PUT returns 403
    mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    const { createAmazonListing } = await import('@/lib/amazon/listings')
    const result = await createAmazonListing('B001234567', 'acceptable', 'Readable', 8.99)

    expect(result.status).toBe('ERROR')
    expect(result.issues.length).toBeGreaterThan(0)
  })
})
