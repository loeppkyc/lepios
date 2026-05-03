import { NextResponse } from 'next/server'
import pLimit from 'p-limit'
import { spApiConfigured } from '@/lib/amazon/client'
import { fetchOrders, fetchOrderItems, type SpOrder, type SpOrderItem } from '@/lib/amazon/orders'
import { getOrderItemsBatch, upsertOrderItems } from '@/lib/amazon/order-items-cache'

// 15-minute server-side cache. Historical days are finalized — data does not change.
// Do NOT use force-dynamic; that would make 10 × N orderItems calls on every page load.
export const revalidate = 900

// Maximum concurrent SP-API /orderItems calls per route invocation.
// Raise only if quota headroom is confirmed; SP-API orderItems bucket is separate
// from the orders-list bucket and is typically 0.5 req/s burst.
const ORDERITEMS_CONCURRENCY = 2

// Response shape — also defined inline in the component (Constraint C-2)
interface RecentDayRow {
  date: string // ISO date string e.g. "2026-04-22"
  orders: number
  revenueCad: number
  units: number
  pendingOrders: number
  pendingRevenueCad: number
  pendingUnits: number
}

interface RecentDaysResponse {
  rows: RecentDayRow[]
  fetchedAt: string
  // Present when one or more orderItems fetches failed (429 or other SP-API error).
  // UI renders a "partial data" banner instead of a full error state.
  partialData?: { failedOrders: number; totalOrders: number }
}

// ── Day-boundary helpers (Edmonton = America/Edmonton) ────────────────────────
//
// dayBoundaryUTC is NOT exported from lib/amazon/orders.ts — reimplemented here
// using the same approach: derive year/month/day in Edmonton timezone, compute
// the UTC offset via Intl, then build an explicit ISO offset string so the result
// is server-timezone-independent (correct on Vercel UTC and local machines alike).

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function dayBoundaryUTC(localDate: Date, boundary: 'start' | 'end'): string {
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = dateFmt.formatToParts(localDate)
  const year = Number(parts.find((p) => p.type === 'year')!.value)
  const month = Number(parts.find((p) => p.type === 'month')!.value)
  const day = Number(parts.find((p) => p.type === 'day')!.value)

  const utcHour = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', hour: '2-digit', hour12: false }).format(
      localDate
    )
  )
  const edHour = Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Edmonton',
      hour: '2-digit',
      hour12: false,
    }).format(localDate)
  )
  let offsetHours = utcHour - edHour
  if (offsetHours < 0) offsetHours += 24
  const offsetStr = `-${pad2(offsetHours)}:00`

  const timeStr = boundary === 'start' ? 'T00:00:00.000' : 'T23:59:59.999'
  return new Date(`${year}-${pad2(month)}-${pad2(day)}${timeStr}${offsetStr}`).toISOString()
}

/** Return the ISO date string (YYYY-MM-DD) for a given Date as seen in Edmonton. */
function edmontonDateString(d: Date): string {
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = dateFmt.formatToParts(d)
  const year = parts.find((p) => p.type === 'year')!.value
  const month = parts.find((p) => p.type === 'month')!.value
  const day = parts.find((p) => p.type === 'day')!.value
  return `${year}-${month}-${day}`
}

interface FinanceMapResult {
  map: Map<string, { revenue: number; tax: number }>
  failedCount: number
  totalConfirmed: number
}

function itemsToFinance(items: SpOrderItem[]): { revenue: number; tax: number } {
  let revenue = 0
  let tax = 0
  for (const item of items) {
    revenue += Number(item.ItemPrice?.Amount ?? 0)
    tax += Number(item.ItemTax?.Amount ?? 0) + Number(item.ShippingTax?.Amount ?? 0)
  }
  return { revenue, tax }
}

/**
 * Build orderId → { revenue, tax } map.
 *
 * Cache-first strategy:
 *   1. Batch SELECT all confirmed orderIds from amazon_order_items (one query).
 *   2. Populate finance values from cache hits immediately.
 *   3. Fetch only cache misses, throttled at ORDERITEMS_CONCURRENCY=2.
 *   4. Upsert fresh results to cache (non-blocking on failure).
 *   5. On 429 exhaustion, track as failed — returns partial data rather than throwing.
 *
 * Pending orders use OrderTotal directly — SP-API returns empty items for them
 * anyway and aggregateDay already falls back to OrderTotal, so the API call
 * is wasted quota. Only confirmed orders fetch orderItems.
 */
async function buildFinanceMap(orders: SpOrder[]): Promise<FinanceMapResult> {
  const map = new Map<string, { revenue: number; tax: number }>()

  // Pending: use OrderTotal directly, no API call needed
  for (const order of orders) {
    if (order.OrderStatus === 'Pending') {
      map.set(order.AmazonOrderId, {
        revenue: Number(order.OrderTotal?.Amount ?? 0),
        tax: 0,
      })
    }
  }

  const confirmedOrders = orders.filter((o) => o.OrderStatus !== 'Pending')
  if (confirmedOrders.length === 0) return { map, failedCount: 0, totalConfirmed: 0 }

  const orderIds = confirmedOrders.map((o) => o.AmazonOrderId)

  // Step 1: batch cache lookup — single SELECT IN query
  const cached = await getOrderItemsBatch(orderIds)

  // Step 2: populate map from cache hits
  for (const [orderId, items] of cached) {
    map.set(orderId, itemsToFinance(items))
  }

  // Step 3: identify misses
  const misses = confirmedOrders.filter((o) => !cached.has(o.AmazonOrderId))

  // Step 4: fetch misses with concurrency throttle
  let failedCount = 0
  if (misses.length > 0) {
    const limit = pLimit(ORDERITEMS_CONCURRENCY)
    await Promise.all(
      misses.map((order) =>
        limit(async () => {
          try {
            const items = await fetchOrderItems(order.AmazonOrderId)
            // Cache write is non-blocking — a write failure does not affect the response
            void upsertOrderItems(order.AmazonOrderId, items)
            map.set(order.AmazonOrderId, itemsToFinance(items))
          } catch {
            // 429 exhausted retries or other SP-API error — count as failed,
            // leave the order absent from the map (aggregateDay falls back to $0).
            failedCount++
          }
        })
      )
    )
  }

  return { map, failedCount, totalConfirmed: confirmedOrders.length }
}

/** Aggregate one day's orders into confirmed and pending buckets. */
function aggregateDay(
  orders: SpOrder[],
  financeMap: Map<string, { revenue: number; tax: number }>
): {
  confirmedCount: number
  revenueCad: number
  units: number
  pendingOrders: number
  pendingRevenueCad: number
  pendingUnits: number
} {
  let confirmedCount = 0
  let revenueCad = 0
  let units = 0
  let pendingOrders = 0
  let pendingRevenueCad = 0
  let pendingUnits = 0

  for (const order of orders) {
    const finance = financeMap.get(order.AmazonOrderId) ?? { revenue: 0, tax: 0 }
    const orderUnits = (order.NumberOfItemsShipped ?? 0) + (order.NumberOfItemsUnshipped ?? 0)

    if (order.OrderStatus === 'Pending') {
      pendingOrders++
      // SP-API returns empty orderItems for most Pending orders (order not yet committed
      // financially), so ItemPrice.Amount is unavailable. Fall back to OrderTotal.Amount,
      // which is the only order-level revenue field. For B2B orders (the common Pending
      // case — net-30 invoicing) OrderTotal equals ItemPrice since B2B is tax-exempt.
      // For consumer Pending orders, OrderTotal includes tax (~5-15% overestimate) but
      // the sub-line is already labeled "pending" implying it is approximate.
      const itemsRevenue = finance.revenue
      pendingRevenueCad += itemsRevenue > 0 ? itemsRevenue : Number(order.OrderTotal?.Amount ?? 0)
      pendingUnits += orderUnits
    } else {
      confirmedCount++
      revenueCad += finance.revenue
      units += orderUnits
    }
  }

  return {
    confirmedCount,
    revenueCad: Math.round(revenueCad * 100) / 100,
    units,
    pendingOrders,
    pendingRevenueCad: Math.round(pendingRevenueCad * 100) / 100,
    pendingUnits,
  }
}

export async function GET() {
  if (!spApiConfigured()) {
    return NextResponse.json({ error: 'SP-API credentials not configured' }, { status: 503 })
  }

  try {
    const now = new Date()

    // Generate 10 day windows: index 0 = yesterday, index 9 = 10 days ago.
    // All windows are fully in the past — safe to pass createdBefore (Constraint C-4).
    const dayWindows: Array<{ dateStr: string; createdAfter: string; createdBefore: string }> = []

    for (let i = 1; i <= 10; i++) {
      const d = new Date(now)
      d.setUTCDate(d.getUTCDate() - i)
      dayWindows.push({
        dateStr: edmontonDateString(d),
        createdAfter: dayBoundaryUTC(d, 'start'),
        createdBefore: dayBoundaryUTC(d, 'end'),
      })
    }

    // Constraint C-5: fetch 10 order-list requests sequentially to respect SP-API rate limits.
    // Per-day orderItems (confirmed only) are cache-first with concurrency=2 for misses.
    const rows: RecentDayRow[] = []
    let totalFailed = 0
    let totalConfirmed = 0

    for (const window of dayWindows) {
      const orders = await fetchOrders({
        createdAfter: window.createdAfter,
        createdBefore: window.createdBefore,
      })

      const {
        map: financeMap,
        failedCount,
        totalConfirmed: dayConfirmed,
      } = await buildFinanceMap(orders)
      totalFailed += failedCount
      totalConfirmed += dayConfirmed

      const agg = aggregateDay(orders, financeMap)

      rows.push({
        date: window.dateStr,
        orders: agg.confirmedCount,
        revenueCad: agg.revenueCad,
        units: agg.units,
        pendingOrders: agg.pendingOrders,
        pendingRevenueCad: agg.pendingRevenueCad,
        pendingUnits: agg.pendingUnits,
      })
    }

    const body: RecentDaysResponse = {
      rows,
      fetchedAt: new Date().toISOString(),
      ...(totalFailed > 0 && {
        partialData: { failedOrders: totalFailed, totalOrders: totalConfirmed },
      }),
    }

    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Kill signal 1: 403 from SP-API Orders — credentials may have been revoked
    if (message.includes('403')) {
      return NextResponse.json(
        { error: `SP-API Orders returned 403 — credentials may have been revoked: ${message}` },
        { status: 502 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
