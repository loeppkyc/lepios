import { describe, it, expect } from 'vitest'
import type { OrdersRow } from '@/lib/amazon/orders-sync'
import type { SettlementRow } from '@/lib/amazon/reports'
import {
  aggregateForKpiRow,
  aggregateForDailyChart,
  aggregateForTopSellers,
  aggregateForStatusBreakdown,
} from '@/lib/amazon/reports'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-27T12:00:00Z')

function makeOrder(overrides: Partial<OrdersRow> = {}): OrdersRow {
  return {
    id: 'ORDER-001-B08XYZ1234',
    product_id: null,
    marketplace: 'amazon_ca',
    order_date: '2026-04-20',
    fiscal_year: 2026,
    asin: 'B08XYZ1234',
    title: 'Test Book',
    quantity: 1,
    revenue_cad: 19.99,
    marketplace_fees: 0,
    shipping_cost: 3.99,
    cogs_cad: 0,
    profit_cad: null,
    currency: 'CAD',
    status: 'Shipped',
    person_handle: 'colin',
    _source: 'sp_api',
    ...overrides,
  }
}

function makeSettlement(overrides: Partial<SettlementRow> = {}): SettlementRow {
  return {
    id: 'settlement-001',
    period_start_at: '2026-04-01T00:00:00Z',
    period_end_at: '2026-04-14T23:59:59Z',
    net_payout: 150.0,
    gross: 200.0,
    fees_total: 50.0,
    fund_transfer_status: 'SUCCESSFUL',
    currency: 'CAD',
    ...overrides,
  }
}

// ── aggregateForKpiRow ────────────────────────────────────────────────────────

describe('aggregateForKpiRow', () => {
  it('empty orders + empty settlements → all zeros, deltas all null', () => {
    const result = aggregateForKpiRow([], [], NOW)
    expect(result.totalOrders).toBe(0)
    expect(result.grossRevenue).toBe(0)
    expect(result.unitsShipped).toBe(0)
    expect(result.netPayout).toBe(0)
    expect(result.deltas.totalOrders).toBeNull()
    expect(result.deltas.grossRevenue).toBeNull()
    expect(result.deltas.unitsShipped).toBeNull()
    expect(result.deltas.netPayout).toBeNull()
  })

  it('orders in current window compute correct totals', () => {
    // order_date = 2026-04-20, NOW = 2026-04-27, so within last 30d
    const orders = [makeOrder({ revenue_cad: 20.0, quantity: 2 })]
    const result = aggregateForKpiRow(orders, [], NOW)
    expect(result.totalOrders).toBe(1)
    expect(result.grossRevenue).toBe(20.0)
    expect(result.unitsShipped).toBe(2)
    expect(result.netPayout).toBe(0)
  })

  it('orders only in prior window (31–60d ago) produce zero current, null deltas resolved', () => {
    // order_date 60d before NOW = 2026-02-26 → prior window
    const priorDate = new Date(NOW.getTime() - 50 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const orders = [makeOrder({ order_date: priorDate, revenue_cad: 30.0, quantity: 1 })]
    const result = aggregateForKpiRow(orders, [], NOW)
    // current window = 0 orders
    expect(result.totalOrders).toBe(0)
    // prior window has 1 order → delta = 0 - 1 = -1
    expect(result.deltas.totalOrders).toBe(-1)
    expect(result.deltas.grossRevenue).toBe(-30.0)
  })

  it('current + prior window orders produce correct positive delta', () => {
    const currentDate = '2026-04-20' // within 30d of NOW
    const priorDate = new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const orders = [
      makeOrder({ id: 'a-asin1', order_date: currentDate, revenue_cad: 25.0, quantity: 2 }),
      makeOrder({ id: 'b-asin1', order_date: priorDate, revenue_cad: 10.0, quantity: 1 }),
    ]
    const result = aggregateForKpiRow(orders, [], NOW)
    expect(result.totalOrders).toBe(1) // only current
    expect(result.grossRevenue).toBe(25.0)
    expect(result.deltas.totalOrders).toBe(0) // 1 current - 1 prior = 0
    expect(result.deltas.grossRevenue).toBeCloseTo(15.0) // 25 - 10
  })

  it('settlements present → netPayout sums correctly (last 35d)', () => {
    // period_end_at within 35d of NOW
    const settlements = [
      makeSettlement({ id: 's1', net_payout: 100.0, period_end_at: '2026-04-20T00:00:00Z' }),
      makeSettlement({ id: 's2', net_payout: 50.5, period_end_at: '2026-04-10T00:00:00Z' }),
    ]
    const result = aggregateForKpiRow([], settlements, NOW)
    expect(result.netPayout).toBeCloseTo(150.5)
  })

  it('settlement outside 35d window is excluded from netPayout', () => {
    // period_end_at 40d before NOW → outside window
    const oldDate = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString()
    const settlements = [makeSettlement({ id: 's-old', net_payout: 999.0, period_end_at: oldDate })]
    const result = aggregateForKpiRow([], settlements, NOW)
    expect(result.netPayout).toBe(0)
    // delta for netPayout should be null (no prior-period settlement data tracked)
    expect(result.deltas.netPayout).toBeNull()
  })
})

// ── aggregateForDailyChart ────────────────────────────────────────────────────

describe('aggregateForDailyChart', () => {
  it('empty orders → 30 days all zeros', () => {
    const result = aggregateForDailyChart([], NOW)
    expect(result).toHaveLength(30)
    expect(result.every((d) => d.revenue === 0 && d.units === 0)).toBe(true)
  })

  it('returns exactly 30 entries ordered oldest first', () => {
    const result = aggregateForDailyChart([], NOW)
    expect(result).toHaveLength(30)
    // first entry should be 29 days before NOW, last = today
    expect(result[0].date).toBe(
      new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    )
    expect(result[29].date).toBe(NOW.toISOString().slice(0, 10))
  })

  it('sparse orders — only some days have data, missing days are zero-filled', () => {
    const orders = [makeOrder({ order_date: '2026-04-20', revenue_cad: 15.0, quantity: 2 })]
    const result = aggregateForDailyChart(orders, NOW)
    expect(result).toHaveLength(30)
    const populated = result.find((d) => d.date === '2026-04-20')
    expect(populated?.revenue).toBe(15.0)
    expect(populated?.units).toBe(2)
    // a day with no orders should be zero
    const empty = result.find((d) => d.date === '2026-04-19')
    expect(empty?.revenue).toBe(0)
    expect(empty?.units).toBe(0)
  })

  it('multiple orders on same day are aggregated', () => {
    const orders = [
      makeOrder({ id: 'a-asin1', order_date: '2026-04-20', revenue_cad: 10.0, quantity: 1 }),
      makeOrder({ id: 'b-asin2', order_date: '2026-04-20', revenue_cad: 5.0, quantity: 2 }),
    ]
    const result = aggregateForDailyChart(orders, NOW)
    const day = result.find((d) => d.date === '2026-04-20')
    expect(day?.revenue).toBeCloseTo(15.0)
    expect(day?.units).toBe(3)
  })

  it('orders outside the 30-day window are excluded', () => {
    // order_date 35d before NOW — outside 30d window
    const oldDate = new Date(NOW.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const orders = [makeOrder({ order_date: oldDate, revenue_cad: 99.0, quantity: 5 })]
    const result = aggregateForDailyChart(orders, NOW)
    expect(result.every((d) => d.revenue === 0)).toBe(true)
  })
})

// ── aggregateForTopSellers ────────────────────────────────────────────────────

describe('aggregateForTopSellers', () => {
  it('empty orders → []', () => {
    expect(aggregateForTopSellers([], NOW)).toEqual([])
  })

  it('multiple ASINs → sorted by revenue descending, top 10 only', () => {
    const orders = Array.from({ length: 15 }, (_, i) =>
      makeOrder({
        id: `order-${i}-B${i.toString().padStart(10, '0')}`,
        asin: `B${i.toString().padStart(10, '0')}`,
        revenue_cad: (15 - i) * 10, // descending: 150, 140, 130 ...
        quantity: 1,
        order_date: '2026-04-20',
      })
    )
    const result = aggregateForTopSellers(orders, NOW)
    expect(result).toHaveLength(10)
    expect(result[0].revenue).toBe(150)
    expect(result[9].revenue).toBe(60)
  })

  it('ties in revenue → stable ordering by ASIN ascending as tiebreaker', () => {
    const orders = [
      makeOrder({
        id: 'o1-B000000002',
        asin: 'B000000002',
        revenue_cad: 20.0,
        order_date: '2026-04-20',
      }),
      makeOrder({
        id: 'o2-B000000001',
        asin: 'B000000001',
        revenue_cad: 20.0,
        order_date: '2026-04-20',
      }),
    ]
    const result = aggregateForTopSellers(orders, NOW)
    expect(result[0].asin).toBe('B000000001')
    expect(result[1].asin).toBe('B000000002')
  })

  it('multiple rows same ASIN → revenue aggregated', () => {
    const orders = [
      makeOrder({
        id: 'o1-B08XYZ1234',
        asin: 'B08XYZ1234',
        revenue_cad: 10.0,
        quantity: 1,
        order_date: '2026-04-20',
      }),
      makeOrder({
        id: 'o2-B08XYZ1234',
        asin: 'B08XYZ1234',
        revenue_cad: 15.0,
        quantity: 2,
        order_date: '2026-04-21',
      }),
    ]
    const result = aggregateForTopSellers(orders, NOW)
    expect(result).toHaveLength(1)
    expect(result[0].revenue).toBeCloseTo(25.0)
    expect(result[0].units).toBe(3)
  })

  it('orders outside 30d window are excluded', () => {
    const oldDate = new Date(NOW.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const orders = [makeOrder({ order_date: oldDate, revenue_cad: 50.0 })]
    expect(aggregateForTopSellers(orders, NOW)).toEqual([])
  })
})

// ── aggregateForStatusBreakdown ───────────────────────────────────────────────

describe('aggregateForStatusBreakdown', () => {
  it('empty → []', () => {
    expect(aggregateForStatusBreakdown([], NOW)).toEqual([])
  })

  it('mixed statuses → each status with correct count, sorted desc', () => {
    const orders = [
      makeOrder({ id: 'a1', status: 'Shipped', order_date: '2026-04-20' }),
      makeOrder({ id: 'a2', status: 'Shipped', order_date: '2026-04-20' }),
      makeOrder({ id: 'a3', status: 'Unshipped', order_date: '2026-04-20' }),
      makeOrder({ id: 'a4', status: 'Canceled', order_date: '2026-04-20' }),
    ]
    const result = aggregateForStatusBreakdown(orders, NOW)
    expect(result[0]).toEqual({ status: 'Shipped', count: 2 })
    expect(result[1].count).toBe(1)
    expect(result).toHaveLength(3)
  })

  it('orders outside 30d window are excluded', () => {
    const oldDate = new Date(NOW.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const orders = [makeOrder({ order_date: oldDate, status: 'Shipped' })]
    expect(aggregateForStatusBreakdown(orders, NOW)).toEqual([])
  })
})
