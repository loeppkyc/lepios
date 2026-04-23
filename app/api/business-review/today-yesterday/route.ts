import { NextResponse } from 'next/server'
import { spApiConfigured } from '@/lib/amazon/client'
import {
  fetchOrders,
  fetchOrderItems,
  aggregateOrders,
  todayMidnightEdmontonUTC,
  yesterdayMidnightEdmontonUTC,
  yesterdayEndEdmontonUTC,
  type SpOrder,
  type SpOrderItem,
  type DayPanelData,
} from '@/lib/amazon/orders'

export const dynamic = 'force-dynamic'

export interface TodayYesterdayResponse {
  today: DayPanelData
  yesterday: DayPanelData
  fetchedAt: string
}

/** Build orderId → { revenue, tax } map from fetched order items. */
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
    const todayAfter = todayMidnightEdmontonUTC()
    const yesterdayAfter = yesterdayMidnightEdmontonUTC()
    const yesterdayBefore = yesterdayEndEdmontonUTC()

    // Constraint 1 (CreatedBefore future-date rule):
    // Today query: omit CreatedBefore — today's end is in the future → HTTP 400
    // Yesterday query: both boundaries are in the past → safe to use both
    const [todayOrders, yesterdayOrders] = await Promise.all([
      fetchOrders({ createdAfter: todayAfter }),
      fetchOrders({ createdAfter: yesterdayAfter, createdBefore: yesterdayBefore }),
    ])

    // Fetch per-item prices for confirmed orders — required for pre-tax revenue.
    // Pending orders are excluded from both fetches.
    const [todayFinanceMap, yesterdayFinanceMap] = await Promise.all([
      buildFinanceMap(todayOrders),
      buildFinanceMap(yesterdayOrders),
    ])

    const today = aggregateOrders(todayOrders, todayFinanceMap)
    const yesterday = aggregateOrders(yesterdayOrders, yesterdayFinanceMap)

    const body: TodayYesterdayResponse = {
      today,
      yesterday,
      fetchedAt: new Date().toISOString(),
    }

    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Kill signal 1: 403 from SP-API Orders
    if (message.includes('403')) {
      return NextResponse.json(
        { error: `SP-API Orders returned 403 — credentials may have been revoked: ${message}` },
        { status: 502 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
