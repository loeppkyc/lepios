import { NextResponse } from 'next/server'
import pLimit from 'p-limit'
import { spApiConfigured } from '@/lib/amazon/client'
import { requireUser } from '@/lib/auth/require-user'
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
import { getOrderItemsBatch, upsertOrderItems } from '@/lib/amazon/order-items-cache'
import { createClient } from '@/lib/supabase/server'

// Always serve fresh — `revalidate = 60` produced stale-while-revalidate
// behavior: first hit after an overnight gap returned the previous day's
// snapshot. Cache hits on amazon_order_items (DB) keep SP-API load low.
export const dynamic = 'force-dynamic'

// Cap concurrent SP-API /orderItems calls. Confirmed orders typically <20
// per panel; misses are rare after the first cache fill.
const ORDERITEMS_CONCURRENCY = 2

export interface DebugOrder {
  id: string
  status: string
  purchaseDate: string | undefined
  units: number
  orderTotal: string | undefined
}

export interface TodayYesterdayResponse {
  today: DayPanelData
  yesterday: DayPanelData
  fetchedAt: string
  /** Estimated net payout from the current open settlement period, or null if unavailable. */
  payout_estimate: number | null
  /**
   * Gross profit MTD from amazon_settlements (net_payout sum for current calendar month,
   * Succeeded or Processing settlements). Labeled "Estimated" — not audited bookkeeping.
   */
  margin_mtd: number | null
  _debug: {
    today: DebugOrder[]
    yesterday: DebugOrder[]
    todayAfter: string
    yesterdayAfter: string
    yesterdayBefore: string
  }
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
 * Build orderId → { revenue, tax } map for confirmed orders.
 *
 * Cache-first (mirrors recent-days route):
 *   1. Batch SELECT cached items for all confirmed orders in one query.
 *   2. Fetch only cache misses, throttled at ORDERITEMS_CONCURRENCY.
 *   3. Upsert misses (non-blocking — cache write failure never breaks the response).
 *
 * Pending orders are skipped — SP-API returns empty items for them and
 * aggregateOrders excludes them from revenue/tax anyway.
 */
async function buildFinanceMap(
  orders: SpOrder[]
): Promise<Map<string, { revenue: number; tax: number }>> {
  const map = new Map<string, { revenue: number; tax: number }>()

  const confirmedOrders = orders.filter((o) => o.OrderStatus !== 'Pending')
  if (confirmedOrders.length === 0) return map

  const orderIds = confirmedOrders.map((o) => o.AmazonOrderId)

  const cached = await getOrderItemsBatch(orderIds)
  for (const [orderId, items] of cached) {
    map.set(orderId, itemsToFinance(items))
  }

  const misses = confirmedOrders.filter((o) => !cached.has(o.AmazonOrderId))
  if (misses.length > 0) {
    const limit = pLimit(ORDERITEMS_CONCURRENCY)
    await Promise.all(
      misses.map((order) =>
        limit(async () => {
          try {
            const items = await fetchOrderItems(order.AmazonOrderId)
            void upsertOrderItems(order.AmazonOrderId, items)
            map.set(order.AmazonOrderId, itemsToFinance(items))
          } catch {
            // SP-API failure (429, network) — leave order absent; aggregateOrders
            // falls back to $0 revenue. Better than failing the whole panel.
          }
        })
      )
    )
  }

  return map
}

function toDebugOrder(o: SpOrder): DebugOrder {
  return {
    id: o.AmazonOrderId,
    status: o.OrderStatus,
    purchaseDate: o.PurchaseDate,
    units: (o.NumberOfItemsShipped ?? 0) + (o.NumberOfItemsUnshipped ?? 0),
    orderTotal: o.OrderTotal?.Amount,
  }
}

/** Query payout estimate and margin MTD from amazon_settlements. Non-throwing. */
async function querySettlementStats(): Promise<{
  payout_estimate: number | null
  margin_mtd: number | null
}> {
  try {
    const supabase = await createClient()
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`

    const { data } = await supabase
      .from('amazon_settlements')
      .select('net_payout, fund_transfer_status, period_end_at')
      .gte('period_end_at', monthStart)
      .lt('period_end_at', monthEnd)

    if (!data || data.length === 0) {
      // Fall back to most recent open settlement as payout estimate
      const { data: recent } = await supabase
        .from('amazon_settlements')
        .select('net_payout, fund_transfer_status')
        .neq('fund_transfer_status', 'Succeeded')
        .order('period_end_at', { ascending: false })
        .limit(1)

      const payout_estimate = recent && recent.length > 0 ? Number(recent[0].net_payout ?? 0) : null
      return { payout_estimate, margin_mtd: null }
    }

    // payout_estimate: sum of non-Succeeded (open/processing) settlements this month
    const openSettlements = data.filter((r) => r.fund_transfer_status !== 'Succeeded')
    const payout_estimate =
      openSettlements.length > 0
        ? openSettlements.reduce((s, r) => s + Number(r.net_payout ?? 0), 0)
        : null

    // margin_mtd: sum of all settlements this month (Succeeded + Processing)
    const margin_mtd = data.reduce((s, r) => s + Number(r.net_payout ?? 0), 0)

    return {
      payout_estimate: payout_estimate !== null ? Math.round(payout_estimate * 100) / 100 : null,
      margin_mtd: Math.round(margin_mtd * 100) / 100,
    }
  } catch {
    // DB error — return nulls, don't break the orders panel
    return { payout_estimate: null, margin_mtd: null }
  }
}

export async function GET() {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

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
    const [todayOrders, yesterdayOrders, settlementStats] = await Promise.all([
      fetchOrders({ createdAfter: todayAfter }),
      fetchOrders({ createdAfter: yesterdayAfter, createdBefore: yesterdayBefore }),
      querySettlementStats(),
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
      payout_estimate: settlementStats.payout_estimate,
      margin_mtd: settlementStats.margin_mtd,
      _debug: {
        today: todayOrders.map(toDebugOrder),
        yesterday: yesterdayOrders.map(toDebugOrder),
        todayAfter,
        yesterdayAfter,
        yesterdayBefore,
      },
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
