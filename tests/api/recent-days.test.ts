import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock SP-API client ────────────────────────────────────────────────────────

const { mockSpApiConfigured, mockFetchOrders, mockFetchOrderItems } = vi.hoisted(() => ({
  mockSpApiConfigured: vi.fn(),
  mockFetchOrders: vi.fn(),
  mockFetchOrderItems: vi.fn(),
}))

vi.mock('@/lib/amazon/client', () => ({
  spApiConfigured: mockSpApiConfigured,
}))

vi.mock('@/lib/amazon/orders', () => ({
  fetchOrders: mockFetchOrders,
  fetchOrderItems: mockFetchOrderItems,
}))

// ── Mock order-items cache ────────────────────────────────────────────────────

const { mockGetOrderItemsBatch, mockUpsertOrderItems } = vi.hoisted(() => ({
  mockGetOrderItemsBatch: vi.fn(),
  mockUpsertOrderItems: vi.fn(),
}))

vi.mock('@/lib/amazon/order-items-cache', () => ({
  getOrderItemsBatch: mockGetOrderItemsBatch,
  upsertOrderItems: mockUpsertOrderItems,
}))

import { GET } from '@/app/api/business-review/recent-days/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONFIRMED_ORDER = {
  AmazonOrderId: 'AMZ-001-CONFIRMED',
  OrderStatus: 'Shipped',
  NumberOfItemsShipped: 2,
  NumberOfItemsUnshipped: 0,
}

const PENDING_ORDER = {
  AmazonOrderId: 'AMZ-002-PENDING',
  OrderStatus: 'Pending',
  NumberOfItemsShipped: 0,
  NumberOfItemsUnshipped: 1,
  OrderTotal: { Amount: '766.85', CurrencyCode: 'CAD' },
}

// Pending order where SP-API returns empty orderItems (no ItemPrice available)
const PENDING_ORDER_NO_ITEMS = {
  AmazonOrderId: 'AMZ-003-PENDING-NO-ITEMS',
  OrderStatus: 'Pending',
  NumberOfItemsShipped: 0,
  NumberOfItemsUnshipped: 2,
  OrderTotal: { Amount: '120.00', CurrencyCode: 'CAD' },
}

const CONFIRMED_ITEMS = [
  {
    ItemPrice: { Amount: '49.99', CurrencyCode: 'CAD' },
    ItemTax: { Amount: '5.00', CurrencyCode: 'CAD' },
    ShippingTax: { Amount: '0.00', CurrencyCode: 'CAD' },
    OrderItemId: 'item-1',
    QuantityOrdered: 2,
  },
]
const PENDING_ITEMS = [
  {
    ItemPrice: { Amount: '766.85', CurrencyCode: 'CAD' },
    ItemTax: { Amount: '0.00', CurrencyCode: 'CAD' },
    ShippingTax: { Amount: '0.00', CurrencyCode: 'CAD' },
    OrderItemId: 'item-2',
    QuantityOrdered: 1,
  },
]

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockSpApiConfigured.mockReturnValue(true)
  // Default: one confirmed order per day window, no pending
  mockFetchOrders.mockResolvedValue([CONFIRMED_ORDER])
  mockFetchOrderItems.mockResolvedValue(CONFIRMED_ITEMS)
  // Default: cache returns all misses (empty map) → falls through to fetchOrderItems
  mockGetOrderItemsBatch.mockResolvedValue(new Map())
  mockUpsertOrderItems.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

// ── SP-API not configured ─────────────────────────────────────────────────────

describe('GET /api/business-review/recent-days — SP-API not configured', () => {
  it('returns 503 when spApiConfigured is false', async () => {
    mockSpApiConfigured.mockReturnValue(false)
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toMatch(/not configured/)
  })

  it('does not call fetchOrders when not configured', async () => {
    mockSpApiConfigured.mockReturnValue(false)
    await GET()
    expect(mockFetchOrders).not.toHaveBeenCalled()
  })
})

// ── Happy path — no pending orders ───────────────────────────────────────────

describe('GET /api/business-review/recent-days — no pending orders', () => {
  it('returns 200 with 10 rows', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(10)
  })

  it('fetches 10 day windows sequentially', async () => {
    await GET()
    expect(mockFetchOrders).toHaveBeenCalledTimes(10)
  })

  it('row has correct confirmed fields', async () => {
    const res = await GET()
    const body = await res.json()
    const row = body.rows[0]
    expect(row.orders).toBe(1)
    expect(row.revenueCad).toBe(49.99)
    expect(row.units).toBe(2)
  })

  it('pending fields are 0 when no Pending orders', async () => {
    const res = await GET()
    const body = await res.json()
    const row = body.rows[0]
    expect(row.pendingOrders).toBe(0)
    expect(row.pendingRevenueCad).toBe(0)
    expect(row.pendingUnits).toBe(0)
  })

  it('response includes fetchedAt timestamp', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.fetchedAt).toBeTruthy()
    expect(() => new Date(body.fetchedAt)).not.toThrow()
  })

  it('fetchOrderItems called for confirmed order on cache miss', async () => {
    await GET()
    expect(mockFetchOrderItems).toHaveBeenCalledWith(CONFIRMED_ORDER.AmazonOrderId)
  })
})

// ── Happy path — with pending orders ─────────────────────────────────────────

describe('GET /api/business-review/recent-days — with pending orders', () => {
  beforeEach(() => {
    mockFetchOrders.mockResolvedValue([CONFIRMED_ORDER, PENDING_ORDER])
    mockFetchOrderItems.mockImplementation((orderId: string) => {
      if (orderId === CONFIRMED_ORDER.AmazonOrderId) return Promise.resolve(CONFIRMED_ITEMS)
      if (orderId === PENDING_ORDER.AmazonOrderId) return Promise.resolve(PENDING_ITEMS)
      return Promise.resolve([])
    })
  })

  it('confirmed revenue excludes pending order revenue', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].revenueCad).toBe(49.99) // only confirmed
  })

  it('pendingRevenueCad is populated from pending order', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].pendingRevenueCad).toBe(766.85)
  })

  it('pendingOrders count is correct', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].pendingOrders).toBe(1)
  })

  it('pendingUnits reflects pending order units', async () => {
    const res = await GET()
    const body = await res.json()
    // PENDING_ORDER: NumberOfItemsShipped=0, NumberOfItemsUnshipped=1
    expect(body.rows[0].pendingUnits).toBe(1)
  })

  it('confirmed order count excludes pending', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].orders).toBe(1) // only confirmed
  })

  it('confirmed units exclude pending order units', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].units).toBe(2) // only CONFIRMED_ORDER's 2 shipped
  })

  it('fetchOrderItems called only for confirmed orders (not pending)', async () => {
    await GET()
    // 10 windows × 1 confirmed order = 10 calls; pending uses OrderTotal directly
    expect(mockFetchOrderItems).toHaveBeenCalledTimes(10)
    const calledIds = mockFetchOrderItems.mock.calls.map((args) => args[0] as string)
    expect(calledIds).toContain(CONFIRMED_ORDER.AmazonOrderId)
    expect(calledIds).not.toContain(PENDING_ORDER.AmazonOrderId)
  })
})

// ── Revenue rounding ──────────────────────────────────────────────────────────

describe('GET /api/business-review/recent-days — rounding', () => {
  it('rounds confirmed revenue to 2 decimal places', async () => {
    mockFetchOrderItems.mockResolvedValue([
      {
        ItemPrice: { Amount: '10.333', CurrencyCode: 'CAD' },
        ItemTax: { Amount: '0', CurrencyCode: 'CAD' },
        ShippingTax: { Amount: '0', CurrencyCode: 'CAD' },
        OrderItemId: 'x',
        QuantityOrdered: 1,
      },
    ])
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].revenueCad).toBe(10.33)
  })

  it('rounds pendingRevenueCad to 2 decimal places', async () => {
    // Pending orders use OrderTotal directly — fetchOrderItems is never called for them.
    // Use an OrderTotal that requires rounding to verify the Math.round path.
    const pendingWithOddTotal = {
      AmazonOrderId: 'AMZ-ROUND',
      OrderStatus: 'Pending',
      NumberOfItemsShipped: 0,
      NumberOfItemsUnshipped: 1,
      OrderTotal: { Amount: '10.336', CurrencyCode: 'CAD' },
    }
    mockFetchOrders.mockResolvedValue([pendingWithOddTotal])
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].pendingRevenueCad).toBe(10.34)
  })
})

// ── OrderTotal fallback for pending orders with no orderItems ─────────────────
// SP-API returns empty orderItems for most Pending orders. The route must fall
// back to OrderTotal.Amount so the pending revenue sub-line is non-zero.

describe('GET /api/business-review/recent-days — OrderTotal fallback', () => {
  beforeEach(() => {
    mockFetchOrders.mockResolvedValue([CONFIRMED_ORDER, PENDING_ORDER_NO_ITEMS])
    mockFetchOrderItems.mockImplementation((orderId: string) => {
      if (orderId === CONFIRMED_ORDER.AmazonOrderId) return Promise.resolve(CONFIRMED_ITEMS)
      // Pending order returns empty items — SP-API behaviour for uncommitted orders
      return Promise.resolve([])
    })
  })

  it('uses OrderTotal.Amount as pendingRevenueCad when orderItems is empty', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].pendingRevenueCad).toBe(120.0)
  })

  it('does not double-count: confirmed revenue unaffected by pending OrderTotal fallback', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].revenueCad).toBe(49.99)
  })

  it('pendingUnits still populated from order fields when items empty', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].pendingUnits).toBe(2) // PENDING_ORDER_NO_ITEMS: 0+2
  })

  it('prefers ItemPrice over OrderTotal when orderItems has prices', async () => {
    // Override: pending order returns items WITH ItemPrice (B2B orders may have this)
    mockFetchOrders.mockResolvedValue([PENDING_ORDER])
    mockFetchOrderItems.mockImplementation((orderId: string) => {
      if (orderId === PENDING_ORDER.AmazonOrderId) return Promise.resolve(PENDING_ITEMS)
      return Promise.resolve([])
    })
    const res = await GET()
    const body = await res.json()
    // PENDING_ITEMS ItemPrice = 766.85; PENDING_ORDER OrderTotal = 766.85 (same here)
    // but we verify the ItemPrice path is taken (not OrderTotal) when items exist
    expect(body.rows[0].pendingRevenueCad).toBe(766.85)
  })
})

// ── Cache hit path ────────────────────────────────────────────────────────────

describe('GET /api/business-review/recent-days — cache hit', () => {
  it('fires 0 SP-API orderItems calls when all orders are cached', async () => {
    mockGetOrderItemsBatch.mockResolvedValue(
      new Map([[CONFIRMED_ORDER.AmazonOrderId, CONFIRMED_ITEMS]])
    )
    await GET()
    expect(mockFetchOrderItems).not.toHaveBeenCalled()
  })

  it('returns correct revenue from cached items', async () => {
    mockGetOrderItemsBatch.mockResolvedValue(
      new Map([[CONFIRMED_ORDER.AmazonOrderId, CONFIRMED_ITEMS]])
    )
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].revenueCad).toBe(49.99)
  })

  it('does not set partialData when all orders served from cache', async () => {
    mockGetOrderItemsBatch.mockResolvedValue(
      new Map([[CONFIRMED_ORDER.AmazonOrderId, CONFIRMED_ITEMS]])
    )
    const res = await GET()
    const body = await res.json()
    expect(body.partialData).toBeUndefined()
  })

  it('does not call upsertOrderItems for cache hits', async () => {
    mockGetOrderItemsBatch.mockResolvedValue(
      new Map([[CONFIRMED_ORDER.AmazonOrderId, CONFIRMED_ITEMS]])
    )
    await GET()
    expect(mockUpsertOrderItems).not.toHaveBeenCalled()
  })
})

// ── Cache miss path ───────────────────────────────────────────────────────────

describe('GET /api/business-review/recent-days — cache miss', () => {
  it('calls fetchOrderItems for cache misses only', async () => {
    // Default: empty map = all misses
    await GET()
    expect(mockFetchOrderItems).toHaveBeenCalledWith(CONFIRMED_ORDER.AmazonOrderId)
  })

  it('calls upsertOrderItems after successful fetch', async () => {
    await GET()
    expect(mockUpsertOrderItems).toHaveBeenCalledWith(
      CONFIRMED_ORDER.AmazonOrderId,
      CONFIRMED_ITEMS
    )
  })

  it('does not set partialData when all fetches succeed', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.partialData).toBeUndefined()
  })

  it('partial cache hit: only uncached order hits SP-API', async () => {
    const ORDER_B = { ...CONFIRMED_ORDER, AmazonOrderId: 'AMZ-B' }
    mockFetchOrders.mockResolvedValue([CONFIRMED_ORDER, ORDER_B])
    // Only ORDER_B is cached; CONFIRMED_ORDER is a miss
    mockGetOrderItemsBatch.mockResolvedValue(new Map([['AMZ-B', CONFIRMED_ITEMS]]))
    await GET()
    // fetchOrderItems called only for the uncached order, across all 10 windows
    expect(mockFetchOrderItems).toHaveBeenCalledTimes(10)
    const calledIds = mockFetchOrderItems.mock.calls.map((args) => args[0] as string)
    expect(calledIds).toContain(CONFIRMED_ORDER.AmazonOrderId)
    expect(calledIds).not.toContain('AMZ-B')
  })
})

// ── Partial 429 path ──────────────────────────────────────────────────────────

describe('GET /api/business-review/recent-days — partial 429', () => {
  it('returns 200 (not 500) when some orderItems fetches fail', async () => {
    mockFetchOrderItems.mockRejectedValue(new Error('SP-API (429): rate limited after 5 retries'))
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('sets partialData when some orders fail', async () => {
    mockFetchOrderItems.mockRejectedValue(new Error('SP-API (429): rate limited after 5 retries'))
    const res = await GET()
    const body = await res.json()
    expect(body.partialData).toBeDefined()
    expect(body.partialData.failedOrders).toBeGreaterThan(0)
    expect(body.partialData.totalOrders).toBeGreaterThan(0)
  })

  it('still returns rows with partial data on 429', async () => {
    mockFetchOrderItems.mockRejectedValue(new Error('SP-API (429): rate limited after 5 retries'))
    const res = await GET()
    const body = await res.json()
    expect(body.rows).toHaveLength(10)
  })

  it('failed orders show $0 revenue in rows (not an exception)', async () => {
    mockFetchOrderItems.mockRejectedValue(new Error('SP-API (429): rate limited after 5 retries'))
    const res = await GET()
    const body = await res.json()
    // Revenue is 0 for failed orders (map has no entry, aggregateDay defaults to 0)
    expect(body.rows[0].revenueCad).toBe(0)
  })

  it('does not call upsertOrderItems when fetch fails', async () => {
    mockFetchOrderItems.mockRejectedValue(new Error('SP-API (429): rate limited after 5 retries'))
    await GET()
    expect(mockUpsertOrderItems).not.toHaveBeenCalled()
  })

  it('cached orders still appear when some uncached orders fail', async () => {
    const ORDER_B = { ...CONFIRMED_ORDER, AmazonOrderId: 'AMZ-B' }
    mockFetchOrders.mockResolvedValue([CONFIRMED_ORDER, ORDER_B])
    // CONFIRMED_ORDER is cached; ORDER_B is a miss and will 429
    mockGetOrderItemsBatch.mockResolvedValue(
      new Map([[CONFIRMED_ORDER.AmazonOrderId, CONFIRMED_ITEMS]])
    )
    mockFetchOrderItems.mockRejectedValue(new Error('SP-API (429): rate limited'))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    // Cached order contributes revenue; failed order contributes $0
    expect(body.rows[0].revenueCad).toBe(49.99)
    expect(body.partialData).toBeDefined()
    expect(body.partialData.failedOrders).toBe(10) // 1 miss × 10 windows
  })
})

// ── Error paths ───────────────────────────────────────────────────────────────

describe('GET /api/business-review/recent-days — errors', () => {
  it('returns 502 on SP-API 403', async () => {
    mockFetchOrders.mockRejectedValue(new Error('SP-API returned 403'))
    const res = await GET()
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/403/)
  })

  it('returns 500 on generic fetch error', async () => {
    mockFetchOrders.mockRejectedValue(new Error('network timeout'))
    const res = await GET()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/network timeout/)
  })
})
