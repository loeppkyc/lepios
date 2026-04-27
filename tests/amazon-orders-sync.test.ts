import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SpOrder, SpOrderItem } from '@/lib/amazon/orders'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/amazon/client', () => ({
  spFetch: vi.fn(),
}))

vi.mock('@/lib/knowledge/client', () => ({
  logEvent: vi.fn().mockResolvedValue(null),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<SpOrder> = {}): SpOrder {
  return {
    AmazonOrderId: '114-1234567-8901234',
    OrderStatus: 'Shipped',
    PurchaseDate: '2026-04-15T18:30:00Z',
    OrderTotal: { Amount: '24.99', CurrencyCode: 'CAD' },
    NumberOfItemsShipped: 1,
    NumberOfItemsUnshipped: 0,
    ...overrides,
  }
}

function makeItem(overrides: Partial<SpOrderItem> = {}): SpOrderItem {
  return {
    OrderItemId: 'item-001',
    ASIN: 'B08XYZ1234',
    Title: 'Test Book Title',
    QuantityOrdered: 1,
    ItemPrice: { Amount: '19.99', CurrencyCode: 'CAD' },
    ItemTax: { Amount: '1.00', CurrencyCode: 'CAD' },
    ShippingPrice: { Amount: '3.99', CurrencyCode: 'CAD' },
    ...overrides,
  }
}

// ── 1. buildRowId ─────────────────────────────────────────────────────────────

describe('buildRowId', () => {
  it('combines orderId and asin with dash', async () => {
    const { buildRowId } = await import('@/lib/amazon/orders-sync')
    expect(buildRowId('114-1234567-8901234', 'B08XYZ1234')).toBe('114-1234567-8901234-B08XYZ1234')
  })

  it('falls back to noasin when asin is empty string', async () => {
    const { buildRowId } = await import('@/lib/amazon/orders-sync')
    expect(buildRowId('114-1234567-8901234', '')).toBe('114-1234567-8901234-noasin')
  })

  it('falls back to noasin when asin is undefined-coerced empty', async () => {
    const { buildRowId } = await import('@/lib/amazon/orders-sync')
    expect(buildRowId('114-0000000-0000000', '')).toBe('114-0000000-0000000-noasin')
  })
})

// ── 2. mapOrderItemToRow ──────────────────────────────────────────────────────

describe('mapOrderItemToRow', () => {
  it('consumer order: uses ItemPrice for revenue, excludes tax from revenue', async () => {
    const { mapOrderItemToRow } = await import('@/lib/amazon/orders-sync')
    const row = mapOrderItemToRow(makeOrder(), makeItem())
    expect(row).not.toBeNull()
    expect(row!.revenue_cad).toBe(19.99)
    expect(row!.status).toBe('Shipped')
    expect(row!.asin).toBe('B08XYZ1234')
    expect(row!.quantity).toBe(1)
    expect(row!.shipping_cost).toBe(3.99)
    expect(row!.marketplace).toBe('amazon_ca')
    expect(row!.currency).toBe('CAD')
    expect(row!._source).toBe('sp_api')
    expect(row!.title).toBe('Test Book Title')
  })

  it('B2B order: no ItemTax — revenue still comes from ItemPrice', async () => {
    const { mapOrderItemToRow } = await import('@/lib/amazon/orders-sync')
    const item = makeItem({ ItemTax: undefined })
    const row = mapOrderItemToRow(makeOrder(), item)
    expect(row!.revenue_cad).toBe(19.99)
  })

  it('consumer order with PromotionDiscount: subtracts promo from revenue', async () => {
    const { mapOrderItemToRow } = await import('@/lib/amazon/orders-sync')
    const item = makeItem({ PromotionDiscount: { Amount: '5.00', CurrencyCode: 'CAD' } })
    const row = mapOrderItemToRow(makeOrder(), item)
    expect(row!.revenue_cad).toBe(14.99)
  })

  it('Pending order with no ItemPrice: uses OrderTotal fallback (F12)', async () => {
    const { mapOrderItemToRow } = await import('@/lib/amazon/orders-sync')
    const order = makeOrder({
      OrderStatus: 'Pending',
      OrderTotal: { Amount: '24.99', CurrencyCode: 'CAD' },
    })
    const item = makeItem({ ItemPrice: undefined })
    const row = mapOrderItemToRow(order, item)
    expect(row!.revenue_cad).toBe(24.99)
    expect(row!.status).toBe('Pending')
  })

  it('Pending order with no OrderTotal and no ItemPrice: revenue=0', async () => {
    const { mapOrderItemToRow } = await import('@/lib/amazon/orders-sync')
    const order = makeOrder({ OrderStatus: 'Pending', OrderTotal: undefined })
    const item = makeItem({ ItemPrice: undefined })
    const row = mapOrderItemToRow(order, item)
    expect(row!.revenue_cad).toBe(0)
  })

  it('Canceled order: included as a row with status=Canceled', async () => {
    const { mapOrderItemToRow } = await import('@/lib/amazon/orders-sync')
    const order = makeOrder({ OrderStatus: 'Canceled' })
    const row = mapOrderItemToRow(order, makeItem())
    expect(row!.status).toBe('Canceled')
    expect(row!.revenue_cad).toBe(19.99)
  })

  it('multi-item order: 2 different ASINs produce 2 different ids', async () => {
    const { mapOrderItemToRow, buildRowId } = await import('@/lib/amazon/orders-sync')
    const order = makeOrder()
    const item1 = makeItem({ ASIN: 'B001', OrderItemId: 'i1' })
    const item2 = makeItem({
      ASIN: 'B002',
      OrderItemId: 'i2',
      ItemPrice: { Amount: '9.99', CurrencyCode: 'CAD' },
    })
    const row1 = mapOrderItemToRow(order, item1)
    const row2 = mapOrderItemToRow(order, item2)
    expect(row1!.id).toBe(buildRowId(order.AmazonOrderId, 'B001'))
    expect(row2!.id).toBe(buildRowId(order.AmazonOrderId, 'B002'))
    expect(row1!.id).not.toBe(row2!.id)
  })

  it('order_date parsed correctly from PurchaseDate', async () => {
    const { mapOrderItemToRow } = await import('@/lib/amazon/orders-sync')
    const row = mapOrderItemToRow(makeOrder({ PurchaseDate: '2026-01-15T07:30:00Z' }), makeItem())
    expect(row!.order_date).toBe('2026-01-15')
    expect(row!.fiscal_year).toBe(2026)
  })

  it('item with no ASIN: asin and id fall back to noasin', async () => {
    const { mapOrderItemToRow } = await import('@/lib/amazon/orders-sync')
    const item = makeItem({ ASIN: undefined })
    const row = mapOrderItemToRow(makeOrder(), item)
    expect(row!.asin).toBe('noasin')
    expect(row!.id).toContain('noasin')
  })

  it('marketplace_fees is 0 (not available from order items API)', async () => {
    const { mapOrderItemToRow } = await import('@/lib/amazon/orders-sync')
    const row = mapOrderItemToRow(makeOrder(), makeItem())
    expect(row!.marketplace_fees).toBe(0)
    expect(row!.cogs_cad).toBe(0)
    expect(row!.profit_cad).toBeNull()
  })
})

// ── 3. dayBoundaryUTC — Edmonton TZ across DST ────────────────────────────────

describe('dayBoundaryUTC — Edmonton timezone', () => {
  it('MDT (summer): midnight Edmonton = 06:00 UTC', async () => {
    // April 15, 2026 is in MDT (UTC-6). Edmonton midnight = 06:00 UTC.
    const { dayBoundaryUTC } = await import('@/lib/amazon/orders')
    // Pass a Date that is noon UTC on Apr 15 — Edmonton reads it as Apr 15
    const date = new Date('2026-04-15T12:00:00Z')
    const result = dayBoundaryUTC(date, 'start')
    // Should be 2026-04-15T06:00:00.000Z (midnight Edmonton MDT)
    expect(result).toBe('2026-04-15T06:00:00.000Z')
  })

  it('MST (winter): midnight Edmonton = 07:00 UTC', async () => {
    // January 15, 2026 is in MST (UTC-7). Edmonton midnight = 07:00 UTC.
    const { dayBoundaryUTC } = await import('@/lib/amazon/orders')
    const date = new Date('2026-01-15T12:00:00Z')
    const result = dayBoundaryUTC(date, 'start')
    // Should be 2026-01-15T07:00:00.000Z (midnight Edmonton MST)
    expect(result).toBe('2026-01-15T07:00:00.000Z')
  })

  it('end boundary: last moment of day in Edmonton', async () => {
    const { dayBoundaryUTC } = await import('@/lib/amazon/orders')
    const date = new Date('2026-04-15T12:00:00Z')
    const result = dayBoundaryUTC(date, 'end')
    // 23:59:59.999 Edmonton MDT = 05:59:59.999 UTC next day
    expect(result).toBe('2026-04-16T05:59:59.999Z')
  })
})

// ── 4. syncOrdersForRange ─────────────────────────────────────────────────────

describe('syncOrdersForRange', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns correct counts for a 2-order sync with items', async () => {
    const { spFetch } = await import('@/lib/amazon/client')
    const mockSpFetch = vi.mocked(spFetch)

    // Orders list response
    mockSpFetch.mockResolvedValueOnce({
      payload: {
        Orders: [
          makeOrder({ AmazonOrderId: 'ORDER-001' }),
          makeOrder({ AmazonOrderId: 'ORDER-002' }),
        ],
      },
    })
    // Items for ORDER-001
    mockSpFetch.mockResolvedValueOnce({
      payload: { OrderItems: [makeItem({ ASIN: 'B001', OrderItemId: 'i1' })] },
    })
    // Items for ORDER-002
    mockSpFetch.mockResolvedValueOnce({
      payload: { OrderItems: [makeItem({ ASIN: 'B002', OrderItemId: 'i2' })] },
    })

    const mockUpsert = vi.fn().mockResolvedValue({ error: null })
    const mockDb = {
      from: vi.fn().mockReturnValue({ upsert: mockUpsert }),
    }

    const { syncOrdersForRange } = await import('@/lib/amazon/orders-sync')
    const result = await syncOrdersForRange({
      startDate: new Date('2026-04-14T00:00:00Z'),
      endDate: new Date('2026-04-15T00:00:00Z'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: mockDb as any,
    })

    expect(result.fetched).toBe(2)
    expect(result.inserted).toBe(2)
    expect(result.errors).toBe(0)
  })

  it('dry-run mode: fetches orders but never upserts', async () => {
    const { spFetch } = await import('@/lib/amazon/client')
    vi.mocked(spFetch)
      .mockResolvedValueOnce({ payload: { Orders: [makeOrder()] } })
      .mockResolvedValueOnce({ payload: { OrderItems: [makeItem()] } })

    const mockUpsert = vi.fn()
    const mockDb = { from: vi.fn().mockReturnValue({ upsert: mockUpsert }) }

    const { syncOrdersForRange } = await import('@/lib/amazon/orders-sync')
    const result = await syncOrdersForRange({
      startDate: new Date('2026-04-14T00:00:00Z'),
      endDate: new Date('2026-04-15T00:00:00Z'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: mockDb as any,
      dryRun: true,
    })

    expect(result.fetched).toBe(1)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('item fetch failure: counts error, does not abort remaining orders', async () => {
    const { spFetch } = await import('@/lib/amazon/client')
    vi.mocked(spFetch)
      .mockResolvedValueOnce({
        payload: {
          Orders: [
            makeOrder({ AmazonOrderId: 'FAIL-001' }),
            makeOrder({ AmazonOrderId: 'OK-002' }),
          ],
        },
      })
      // Item fetch for FAIL-001 throws
      .mockRejectedValueOnce(new Error('SP-API 503'))
      // Items for OK-002
      .mockResolvedValueOnce({ payload: { OrderItems: [makeItem()] } })

    const mockUpsert = vi.fn().mockResolvedValue({ error: null })
    const mockDb = { from: vi.fn().mockReturnValue({ upsert: mockUpsert }) }

    const { syncOrdersForRange } = await import('@/lib/amazon/orders-sync')
    const result = await syncOrdersForRange({
      startDate: new Date('2026-04-14T00:00:00Z'),
      endDate: new Date('2026-04-15T00:00:00Z'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: mockDb as any,
    })

    expect(result.errors).toBe(1)
    expect(result.fetched).toBe(2)
    // OK-002 still inserted despite FAIL-001 error
    expect(result.inserted).toBe(1)
  })

  it('upsert DB error: counts as error, continues', async () => {
    const { spFetch } = await import('@/lib/amazon/client')
    vi.mocked(spFetch)
      .mockResolvedValueOnce({ payload: { Orders: [makeOrder()] } })
      .mockResolvedValueOnce({ payload: { OrderItems: [makeItem()] } })

    const mockUpsert = vi.fn().mockResolvedValue({ error: new Error('DB constraint') })
    const mockDb = { from: vi.fn().mockReturnValue({ upsert: mockUpsert }) }

    const { syncOrdersForRange } = await import('@/lib/amazon/orders-sync')
    const result = await syncOrdersForRange({
      startDate: new Date('2026-04-14T00:00:00Z'),
      endDate: new Date('2026-04-15T00:00:00Z'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: mockDb as any,
    })

    expect(result.errors).toBe(1)
    expect(result.inserted).toBe(0)
  })

  it('empty item list: order skipped (no row created)', async () => {
    const { spFetch } = await import('@/lib/amazon/client')
    vi.mocked(spFetch)
      .mockResolvedValueOnce({ payload: { Orders: [makeOrder()] } })
      .mockResolvedValueOnce({ payload: { OrderItems: [] } })

    const mockUpsert = vi.fn()
    const mockDb = { from: vi.fn().mockReturnValue({ upsert: mockUpsert }) }

    const { syncOrdersForRange } = await import('@/lib/amazon/orders-sync')
    const result = await syncOrdersForRange({
      startDate: new Date('2026-04-14T00:00:00Z'),
      endDate: new Date('2026-04-15T00:00:00Z'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: mockDb as any,
    })

    expect(result.fetched).toBe(1)
    expect(result.skipped).toBe(1)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  // ── CreatedBefore future-date fix (Constraint 1) ──────────────────────────

  it('omits CreatedBefore when endDate is today (prevents SP-API 400)', async () => {
    const { spFetch } = await import('@/lib/amazon/client')
    vi.mocked(spFetch).mockResolvedValue({ payload: { Orders: [] } })

    const mockDb = { from: vi.fn().mockReturnValue({ upsert: vi.fn() }) }
    const { syncOrdersForRange } = await import('@/lib/amazon/orders-sync')

    const now = new Date()
    await syncOrdersForRange({
      startDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      endDate: now,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: mockDb as any,
    })

    const firstCall = vi.mocked(spFetch).mock.calls[0]
    expect(firstCall[1]?.params).not.toHaveProperty('CreatedBefore')
  })

  it('omits CreatedBefore when endDate is in the future', async () => {
    const { spFetch } = await import('@/lib/amazon/client')
    vi.mocked(spFetch).mockResolvedValue({ payload: { Orders: [] } })

    const mockDb = { from: vi.fn().mockReturnValue({ upsert: vi.fn() }) }
    const { syncOrdersForRange } = await import('@/lib/amazon/orders-sync')

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await syncOrdersForRange({
      startDate: new Date(),
      endDate: tomorrow,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: mockDb as any,
    })

    const firstCall = vi.mocked(spFetch).mock.calls[0]
    expect(firstCall[1]?.params).not.toHaveProperty('CreatedBefore')
  })

  it('includes CreatedBefore when endDate is yesterday (fully past)', async () => {
    const { spFetch } = await import('@/lib/amazon/client')
    vi.mocked(spFetch).mockResolvedValue({ payload: { Orders: [] } })

    const mockDb = { from: vi.fn().mockReturnValue({ upsert: vi.fn() }) }
    const { syncOrdersForRange } = await import('@/lib/amazon/orders-sync')

    // Use a fixed past date guaranteed to have a past end-of-day boundary
    const yesterday = new Date('2026-04-15T00:00:00Z')
    await syncOrdersForRange({
      startDate: new Date('2026-04-14T00:00:00Z'),
      endDate: yesterday,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: mockDb as any,
    })

    const firstCall = vi.mocked(spFetch).mock.calls[0]
    expect(firstCall[1]?.params).toHaveProperty('CreatedBefore')
  })
})
