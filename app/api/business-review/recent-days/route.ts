import { NextResponse } from 'next/server'
import { spApiConfigured } from '@/lib/amazon/client'
import {
  fetchOrders,
  fetchOrderItems,
  aggregateOrders,
  type SpOrder,
  type SpOrderItem,
} from '@/lib/amazon/orders'

// 15-minute server-side cache. Historical days are finalized — data does not change.
// Do NOT use force-dynamic; that would make 10 × N orderItems calls on every page load.
export const revalidate = 900

// Response shape — also defined inline in the component (Constraint C-2)
interface RecentDayRow {
  date: string // ISO date string e.g. "2026-04-22"
  orders: number
  revenueCad: number
  units: number
}

interface RecentDaysResponse {
  rows: RecentDayRow[]
  fetchedAt: string
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

/** Build orderId → { revenue, tax } map from confirmed order items. */
async function buildFinanceMap(
  orders: SpOrder[]
): Promise<Map<string, { revenue: number; tax: number }>> {
  const confirmedIds = orders.filter((o) => o.OrderStatus !== 'Pending').map((o) => o.AmazonOrderId)

  const allItems = await Promise.all(
    confirmedIds.map((id) => fetchOrderItems(id).then((items) => ({ id, items })))
  )

  const map = new Map<string, { revenue: number; tax: number }>()
  for (const { id, items } of allItems) {
    let revenue = 0
    let tax = 0
    for (const item of items as SpOrderItem[]) {
      revenue += Number(item.ItemPrice?.Amount ?? 0)
      tax += Number(item.ItemTax?.Amount ?? 0) + Number(item.ShippingTax?.Amount ?? 0)
    }
    map.set(id, { revenue, tax })
  }
  return map
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
      // Subtract i days from today to get the target Edmonton calendar day
      d.setUTCDate(d.getUTCDate() - i)
      dayWindows.push({
        dateStr: edmontonDateString(d),
        createdAfter: dayBoundaryUTC(d, 'start'),
        createdBefore: dayBoundaryUTC(d, 'end'),
      })
    }

    // Constraint C-5: fetch 10 order-list requests sequentially to respect SP-API rate limits.
    // Per-day orderItems are then fetched in parallel (one per confirmed order ID).
    const rows: RecentDayRow[] = []

    // Collect all orders per day for sequential fetching
    for (const window of dayWindows) {
      const orders = await fetchOrders({
        createdAfter: window.createdAfter,
        createdBefore: window.createdBefore,
      })

      // Fetch all orderItems in parallel for this day's confirmed orders
      const financeMap = await buildFinanceMap(orders)
      const agg = aggregateOrders(orders, financeMap)

      rows.push({
        date: window.dateStr,
        orders: agg.confirmedCount,
        revenueCad: agg.revenueCad,
        units: agg.unitsSold,
      })
    }

    // Rows are already ordered most-recent-first (yesterday at index 0)
    const body: RecentDaysResponse = {
      rows,
      fetchedAt: new Date().toISOString(),
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
