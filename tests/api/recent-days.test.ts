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

  it('fetchOrderItems called for confirmed order', async () => {
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

  it('fetchOrderItems is called for BOTH confirmed and pending orders', async () => {
    await GET()
    // 10 windows × 2 orders each = 20 calls total
    expect(mockFetchOrderItems).toHaveBeenCalledTimes(20)
    // Both order IDs appear
    const calledIds = mockFetchOrderItems.mock.calls.map(([id]: [string]) => id)
    expect(calledIds).toContain(CONFIRMED_ORDER.AmazonOrderId)
    expect(calledIds).toContain(PENDING_ORDER.AmazonOrderId)
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
    mockFetchOrders.mockResolvedValue([PENDING_ORDER])
    mockFetchOrderItems.mockResolvedValue([
      {
        ItemPrice: { Amount: '10.336', CurrencyCode: 'CAD' },
        ItemTax: { Amount: '0', CurrencyCode: 'CAD' },
        ShippingTax: { Amount: '0', CurrencyCode: 'CAD' },
        OrderItemId: 'x',
        QuantityOrdered: 1,
      },
    ])
    const res = await GET()
    const body = await res.json()
    expect(body.rows[0].pendingRevenueCad).toBe(10.34)
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
