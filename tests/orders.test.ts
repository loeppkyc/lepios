import { describe, it, expect } from 'vitest'
import { aggregateOrders, type SpOrder } from '@/lib/amazon/orders'

// ── aggregateOrders ───────────────────────────────────────────────────────────

describe('aggregateOrders', () => {
  function makeOrder(status: SpOrder['OrderStatus'], shipped = 0, unshipped = 0): SpOrder {
    return {
      AmazonOrderId: `AMZ-${Math.random().toString(36).slice(2)}`,
      OrderStatus: status,
      NumberOfItemsShipped: shipped,
      NumberOfItemsUnshipped: unshipped,
    }
  }

  function financeMap(
    orders: SpOrder[],
    entries: Array<{ order: SpOrder; revenue: number; tax?: number }>
  ): Map<string, { revenue: number; tax: number }> {
    const map = new Map<string, { revenue: number; tax: number }>()
    for (const { order, revenue, tax = 0 } of entries) {
      map.set(order.AmazonOrderId, { revenue, tax })
    }
    return map
  }

  it('counts only confirmed statuses — not Pending', () => {
    const o1 = makeOrder('Unshipped')
    const o2 = makeOrder('Shipped')
    const o3 = makeOrder('Pending')
    const result = aggregateOrders([o1, o2, o3], new Map())
    expect(result.confirmedCount).toBe(2)
    expect(result.pendingCount).toBe(1)
  })

  it('includes Canceled in confirmed count', () => {
    const o = makeOrder('Canceled')
    const result = aggregateOrders([o], new Map())
    expect(result.confirmedCount).toBe(1)
    expect(result.pendingCount).toBe(0)
  })

  it('includes PartiallyShipped in confirmed count', () => {
    const o = makeOrder('PartiallyShipped')
    const result = aggregateOrders([o], new Map())
    expect(result.confirmedCount).toBe(1)
  })

  it('sums revenue from confirmed orders only — excludes Pending', () => {
    const o1 = makeOrder('Shipped')
    const o2 = makeOrder('Unshipped')
    const o3 = makeOrder('Pending')
    const map = financeMap(
      [],
      [
        { order: o1, revenue: 25.0, tax: 3.0 },
        { order: o2, revenue: 10.5, tax: 1.26 },
        { order: o3, revenue: 99.0, tax: 11.88 }, // must not contribute
      ]
    )
    const result = aggregateOrders([o1, o2, o3], map)
    expect(result.revenueCad).toBe(35.5)
  })

  it('sums tax from confirmed orders only — excludes Pending', () => {
    const o1 = makeOrder('Shipped')
    const o2 = makeOrder('Unshipped')
    const o3 = makeOrder('Pending')
    const map = financeMap(
      [],
      [
        { order: o1, revenue: 25.0, tax: 3.0 },
        { order: o2, revenue: 10.5, tax: 1.26 },
        { order: o3, revenue: 99.0, tax: 11.88 }, // must not contribute
      ]
    )
    const result = aggregateOrders([o1, o2, o3], map)
    expect(result.taxCad).toBe(4.26)
  })

  it('returns 0 revenue and 0 tax when all orders are Pending', () => {
    const o1 = makeOrder('Pending')
    const o2 = makeOrder('Pending')
    const map = financeMap(
      [],
      [
        { order: o1, revenue: 50.0, tax: 6.0 },
        { order: o2, revenue: 20.0, tax: 2.4 },
      ]
    )
    const result = aggregateOrders([o1, o2], map)
    expect(result.revenueCad).toBe(0)
    expect(result.taxCad).toBe(0)
    expect(result.confirmedCount).toBe(0)
    expect(result.pendingCount).toBe(2)
  })

  it('sums units across confirmed orders only; pendingUnits tracked separately', () => {
    const o1 = makeOrder('Shipped', 2, 0)
    const o2 = makeOrder('Unshipped', 0, 3)
    const o3 = makeOrder('Pending', 10, 10)
    const result = aggregateOrders([o1, o2, o3], new Map())
    expect(result.unitsSold).toBe(5) // confirmed only: 2 + 3
    expect(result.pendingUnits).toBe(20) // pending: 10 + 10
  })

  it('handles missing finance map entry gracefully (treats as $0 revenue and $0 tax)', () => {
    const o: SpOrder = {
      AmazonOrderId: 'AMZ-000',
      OrderStatus: 'Shipped',
      NumberOfItemsShipped: 1,
      NumberOfItemsUnshipped: 0,
    }
    // empty map — no entry for this order
    const result = aggregateOrders([o], new Map())
    expect(result.confirmedCount).toBe(1)
    expect(result.revenueCad).toBe(0)
    expect(result.taxCad).toBe(0)
  })

  it('rounds revenue to 2 decimal places', () => {
    const o1 = makeOrder('Shipped')
    const o2 = makeOrder('Shipped')
    const map = financeMap(
      [],
      [
        { order: o1, revenue: 10.333 },
        { order: o2, revenue: 5.666 },
      ]
    )
    const result = aggregateOrders([o1, o2], map)
    // 10.333 + 5.666 = 15.999 → rounds to 16.00
    expect(result.revenueCad).toBe(16.0)
  })

  it('rounds tax to 2 decimal places', () => {
    const o1 = makeOrder('Shipped')
    const o2 = makeOrder('Shipped')
    const map = financeMap(
      [],
      [
        { order: o1, revenue: 10.0, tax: 1.333 },
        { order: o2, revenue: 5.0, tax: 0.666 },
      ]
    )
    const result = aggregateOrders([o1, o2], map)
    // 1.333 + 0.666 = 1.999 → rounds to 2.00
    expect(result.taxCad).toBe(2.0)
  })

  it('returns zero counts on empty array', () => {
    const result = aggregateOrders([], new Map())
    expect(result.confirmedCount).toBe(0)
    expect(result.revenueCad).toBe(0)
    expect(result.taxCad).toBe(0)
    expect(result.unitsSold).toBe(0)
    expect(result.pendingCount).toBe(0)
    expect(result.pendingUnits).toBe(0)
  })

  it('pending indicator: shows when confirmedCount = 0 and pendingCount > 0', () => {
    const o1 = makeOrder('Pending')
    const o2 = makeOrder('Pending')
    const { confirmedCount, pendingCount } = aggregateOrders([o1, o2], new Map())
    expect(confirmedCount === 0 && pendingCount > 0).toBe(true)
  })

  it('pending indicator: does NOT show when confirmedCount > 0', () => {
    const o1 = makeOrder('Shipped')
    const o2 = makeOrder('Pending')
    const { confirmedCount, pendingCount } = aggregateOrders([o1, o2], new Map())
    expect(confirmedCount > 0).toBe(true)
    expect(confirmedCount === 0 && pendingCount > 0).toBe(false)
  })

  it('real-world grounding case: LEGO order $34.99 + $4.20 BC tax', () => {
    const o = makeOrder('Shipped', 1, 0)
    const map = new Map([[o.AmazonOrderId, { revenue: 34.99, tax: 4.2 }]])
    const result = aggregateOrders([o], map)
    expect(result.revenueCad).toBe(34.99)
    expect(result.taxCad).toBe(4.2)
    expect(result.confirmedCount).toBe(1)
  })
})
