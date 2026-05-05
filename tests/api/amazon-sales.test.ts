/**
 * Tests for app/api/amazon-sales/route.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockFrom, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({ auth: { getUser: mockGetUser } })),
}))

import { GET } from '@/app/api/amazon-sales/route'
import type { AmazonSalesPayload } from '@/app/api/amazon-sales/route'

beforeEach(() => {
  mockFrom.mockReset()
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  vi.useFakeTimers()
  // Pin "today" to a known date for deterministic ranges.
  vi.setSystemTime(new Date('2026-05-05T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

function req(window: string | null = null): Request {
  const url = window
    ? `http://localhost/api/amazon-sales?window=${window}`
    : 'http://localhost/api/amazon-sales'
  return new Request(url)
}

interface OrdersChain {
  orders: Array<{ order_date: string; revenue_cad: number; quantity: number }>
}

interface SettlementsChain {
  settlements: Array<{
    id: string
    period_start_at: string
    period_end_at: string
    net_payout: number
    fund_transfer_status: string
  }>
}

function buildOrdersTable(state: OrdersChain) {
  // The route uses one of two chains:
  //   .from('orders').select(...).eq(...).order(...).gte(...) — for the windowed query
  //   .from('orders').select(...).eq(...).gte(...) — for the month KPI
  const data = state.orders
  const terminal = Promise.resolve({ data, error: null }) as unknown as {
    then: Promise<{ data: typeof data; error: null }>['then']
    gte: () => typeof terminal
  }
  ;(terminal as unknown as { gte: () => unknown }).gte = () => terminal
  return {
    select: () => ({
      eq: () => ({
        order: () => terminal,
        gte: () => terminal,
      }),
    }),
  }
}

function buildSettlementsTable(state: SettlementsChain) {
  return {
    select: () => ({
      eq: () => ({
        order: () => Promise.resolve({ data: state.settlements, error: null }),
      }),
    }),
  }
}

describe('GET /api/amazon-sales — auth', () => {
  it('returns 401 when no user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await GET(req())
    expect(res.status).toBe(401)
  })
})

describe('GET /api/amazon-sales — payload shape', () => {
  it('returns the full shape with empty data', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') return buildOrdersTable({ orders: [] })
      if (table === 'amazon_settlements') return buildSettlementsTable({ settlements: [] })
      throw new Error(`unmocked: ${table}`)
    })

    const res = await GET(req('30d'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as AmazonSalesPayload
    expect(body.window).toBe('30d')
    expect(body.dailySeries).toEqual([])
    expect(body.kpis.monthSales).toBe(0)
    expect(body.kpis.bestDay).toBe(0)
    expect(body.kpis.bestDayDate).toBeNull()
    expect(body.rollingWindows).toHaveLength(4)
    expect(body.rollingWindows.map((r) => r.label)).toEqual(['7d', '30d', '60d', '90d'])
    expect(body.monthlyAvailable).toBe(false)
  })

  it('aggregates daily revenue + units correctly', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders')
        return buildOrdersTable({
          orders: [
            { order_date: '2026-04-29', revenue_cad: 100, quantity: 2 },
            { order_date: '2026-04-29', revenue_cad: 50, quantity: 1 },
            { order_date: '2026-04-30', revenue_cad: 75, quantity: 1 },
            { order_date: '2026-05-01', revenue_cad: 200, quantity: 3 },
          ],
        })
      if (table === 'amazon_settlements') return buildSettlementsTable({ settlements: [] })
      throw new Error(`unmocked: ${table}`)
    })

    const res = await GET(req('all'))
    const body = (await res.json()) as AmazonSalesPayload
    expect(body.dailySeries).toHaveLength(3)
    const apr29 = body.dailySeries.find((d) => d.date === '2026-04-29')!
    expect(apr29.revenue).toBe(150) // 100 + 50
    expect(apr29.units).toBe(3)
    expect(body.dailySeries.find((d) => d.date === '2026-05-01')!.revenue).toBe(200)
  })

  it('computes rolling 7-day average correctly', async () => {
    const orders = Array.from({ length: 10 }, (_, i) => ({
      order_date: `2026-04-${String(20 + i).padStart(2, '0')}`,
      revenue_cad: 100,
      quantity: 1,
    }))
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') return buildOrdersTable({ orders })
      if (table === 'amazon_settlements') return buildSettlementsTable({ settlements: [] })
      throw new Error(`unmocked: ${table}`)
    })

    const res = await GET(req('all'))
    const body = (await res.json()) as AmazonSalesPayload
    expect(body.dailySeries).toHaveLength(10)
    // First day's roll7 = single observation = 100
    expect(body.dailySeries[0].roll7).toBe(100)
    // Day 7+ should still be 100 (constant input)
    expect(body.dailySeries[6].roll7).toBe(100)
    expect(body.dailySeries[9].roll7).toBe(100)
  })

  it('picks bestDay correctly', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders')
        return buildOrdersTable({
          orders: [
            { order_date: '2026-04-29', revenue_cad: 100, quantity: 1 },
            { order_date: '2026-04-30', revenue_cad: 500, quantity: 5 },
            { order_date: '2026-05-01', revenue_cad: 300, quantity: 3 },
          ],
        })
      if (table === 'amazon_settlements') return buildSettlementsTable({ settlements: [] })
      throw new Error(`unmocked: ${table}`)
    })

    const res = await GET(req('all'))
    const body = (await res.json()) as AmazonSalesPayload
    expect(body.kpis.bestDay).toBe(500)
    expect(body.kpis.bestDayDate).toBe('2026-04-30')
  })

  it('classifies month vs prev-month sales correctly', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders')
        return buildOrdersTable({
          orders: [
            // April (prev) and May (current) — system time pinned to 2026-05-05
            { order_date: '2026-04-15', revenue_cad: 100, quantity: 1 },
            { order_date: '2026-04-30', revenue_cad: 200, quantity: 2 },
            { order_date: '2026-05-01', revenue_cad: 50, quantity: 1 },
            { order_date: '2026-05-05', revenue_cad: 150, quantity: 1 },
          ],
        })
      if (table === 'amazon_settlements') return buildSettlementsTable({ settlements: [] })
      throw new Error(`unmocked: ${table}`)
    })

    const res = await GET(req('all'))
    const body = (await res.json()) as AmazonSalesPayload
    expect(body.kpis.monthSales).toBe(200) // 50 + 150 in May
    expect(body.kpis.monthSalesPrev).toBe(300) // 100 + 200 in April
  })

  it('classifies settlement net payout by month', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') return buildOrdersTable({ orders: [] })
      if (table === 'amazon_settlements')
        return buildSettlementsTable({
          settlements: [
            {
              id: 's1',
              period_start_at: '2026-04-10T00:00:00Z',
              period_end_at: '2026-04-12T00:00:00Z',
              net_payout: 1000,
              fund_transfer_status: 'Succeeded',
            },
            {
              id: 's2',
              period_start_at: '2026-05-01T00:00:00Z',
              period_end_at: '2026-05-03T00:00:00Z',
              net_payout: 750,
              fund_transfer_status: 'Succeeded',
            },
          ],
        })
      throw new Error(`unmocked: ${table}`)
    })

    const res = await GET(req('all'))
    const body = (await res.json()) as AmazonSalesPayload
    expect(body.kpis.monthNet).toBe(750)
    expect(body.kpis.monthNetPrev).toBe(1000)
    expect(body.settlements).toHaveLength(2)
  })

  it('returns top 5 days sorted by revenue', async () => {
    const orders = [10, 50, 5, 100, 75, 20, 80, 60].map((rev, i) => ({
      order_date: `2026-04-${String(20 + i).padStart(2, '0')}`,
      revenue_cad: rev,
      quantity: 1,
    }))
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') return buildOrdersTable({ orders })
      if (table === 'amazon_settlements') return buildSettlementsTable({ settlements: [] })
      throw new Error(`unmocked: ${table}`)
    })

    const res = await GET(req('all'))
    const body = (await res.json()) as AmazonSalesPayload
    expect(body.topDays.map((d) => d.revenue)).toEqual([100, 80, 75, 60, 50])
  })

  it('defaults to 90d when window param is missing or invalid', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') return buildOrdersTable({ orders: [] })
      if (table === 'amazon_settlements') return buildSettlementsTable({ settlements: [] })
      throw new Error(`unmocked: ${table}`)
    })

    const res1 = await GET(req(null))
    const body1 = (await res1.json()) as AmazonSalesPayload
    expect(body1.window).toBe('90d')

    const res2 = await GET(req('bogus'))
    const body2 = (await res2.json()) as AmazonSalesPayload
    expect(body2.window).toBe('90d')
  })
})
