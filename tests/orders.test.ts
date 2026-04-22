import { describe, it, expect } from 'vitest'
import { aggregateOrders, type SpOrder } from '@/lib/amazon/orders'

// ── aggregateOrders ───────────────────────────────────────────────────────────

describe('aggregateOrders', () => {
  function makeOrder(
    status: SpOrder['OrderStatus'],
    amount = '0.00',
    shipped = 0,
    unshipped = 0
  ): SpOrder {
    return {
      AmazonOrderId: `AMZ-${Math.random()}`,
      OrderStatus: status,
      OrderTotal: { Amount: amount, CurrencyCode: 'CAD' },
      NumberOfItemsShipped: shipped,
      NumberOfItemsUnshipped: unshipped,
    }
  }

  it('counts only confirmed statuses — not Pending', () => {
    const orders = [makeOrder('Unshipped'), makeOrder('Shipped'), makeOrder('Pending')]
    const result = aggregateOrders(orders)
    expect(result.confirmedCount).toBe(2)
    expect(result.pendingCount).toBe(1)
  })

  it('includes Canceled in confirmed count', () => {
    const orders = [makeOrder('Canceled')]
    const result = aggregateOrders(orders)
    expect(result.confirmedCount).toBe(1)
    expect(result.pendingCount).toBe(0)
  })

  it('includes PartiallyShipped in confirmed count', () => {
    const orders = [makeOrder('PartiallyShipped')]
    const result = aggregateOrders(orders)
    expect(result.confirmedCount).toBe(1)
  })

  it('sums revenue from confirmed orders only — excludes Pending', () => {
    const orders = [
      makeOrder('Shipped', '25.00'),
      makeOrder('Unshipped', '10.50'),
      makeOrder('Pending', '99.00'), // must not contribute to revenue
    ]
    const result = aggregateOrders(orders)
    expect(result.revenueCad).toBe(35.5)
  })

  it('returns 0 revenue when all orders are Pending', () => {
    const orders = [makeOrder('Pending', '50.00'), makeOrder('Pending', '20.00')]
    const result = aggregateOrders(orders)
    expect(result.revenueCad).toBe(0)
    expect(result.confirmedCount).toBe(0)
    expect(result.pendingCount).toBe(2)
  })

  it('sums units (shipped + unshipped) across confirmed orders only', () => {
    const orders = [
      makeOrder('Shipped', '10.00', 2, 0),
      makeOrder('Unshipped', '5.00', 0, 3),
      makeOrder('Pending', '5.00', 10, 10), // must not contribute to units
    ]
    const result = aggregateOrders(orders)
    expect(result.unitsSold).toBe(5) // 2 + 0 + 0 + 3
  })

  it('handles missing OrderTotal gracefully (treats as $0)', () => {
    const order: SpOrder = {
      AmazonOrderId: 'AMZ-000',
      OrderStatus: 'Shipped',
      NumberOfItemsShipped: 1,
      NumberOfItemsUnshipped: 0,
      // OrderTotal intentionally absent
    }
    const result = aggregateOrders([order])
    expect(result.confirmedCount).toBe(1)
    expect(result.revenueCad).toBe(0)
  })

  it('rounds revenue to 2 decimal places', () => {
    const orders = [makeOrder('Shipped', '10.333'), makeOrder('Shipped', '5.666')]
    const result = aggregateOrders(orders)
    // 10.333 + 5.666 = 15.999 → rounds to 16.00
    expect(result.revenueCad).toBe(16.0)
  })

  it('returns zero counts on empty array', () => {
    const result = aggregateOrders([])
    expect(result.confirmedCount).toBe(0)
    expect(result.revenueCad).toBe(0)
    expect(result.unitsSold).toBe(0)
    expect(result.pendingCount).toBe(0)
  })

  it('pending indicator: shows when confirmedCount = 0 and pendingCount > 0', () => {
    const orders = [makeOrder('Pending'), makeOrder('Pending')]
    const { confirmedCount, pendingCount } = aggregateOrders(orders)
    // The component shows the indicator when this condition is true
    expect(confirmedCount === 0 && pendingCount > 0).toBe(true)
  })

  it('pending indicator: does NOT show when confirmedCount > 0', () => {
    const orders = [makeOrder('Shipped'), makeOrder('Pending')]
    const { confirmedCount, pendingCount } = aggregateOrders(orders)
    expect(confirmedCount > 0).toBe(true)
    // Condition is false — indicator suppressed
    expect(confirmedCount === 0 && pendingCount > 0).toBe(false)
  })
})
