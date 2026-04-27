import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchOrders, fetchOrderItems, dayBoundaryUTC } from './orders'
import type { SpOrder, SpOrderItem } from './orders'

// ── Public types ──────────────────────────────────────────────────────────────

export interface OrdersRow {
  id: string // "{AmazonOrderId}-{ASIN}" — composite text PK
  product_id: null // FK reserved for future products table
  marketplace: 'amazon_ca'
  order_date: string // YYYY-MM-DD (from PurchaseDate, UTC slice)
  fiscal_year: number
  asin: string
  title: string | null
  quantity: number
  revenue_cad: number // pre-tax ItemPrice; OrderTotal fallback for Pending (F12)
  marketplace_fees: number // always 0 — fees not in order items API, come from settlement
  shipping_cost: number
  cogs_cad: number // always 0 — not available from SP-API
  profit_cad: null // computed separately after COGS available
  currency: 'CAD'
  status: string
  person_handle: 'colin'
  _source: 'sp_api'
}

export interface SyncResult {
  fetched: number // total orders returned by SP-API
  inserted: number // rows upserted (new + updated)
  skipped: number // orders with no items (empty order items response)
  errors: number // per-order failures (item fetch or DB write)
}

export interface SyncParams {
  startDate: Date
  endDate: Date
  supabase: SupabaseClient
  dryRun?: boolean // fetch + map but do not write to DB
}

// ── Transform helpers ─────────────────────────────────────────────────────────

/** Stable composite PK: "{AmazonOrderId}-{ASIN}" */
export function buildRowId(orderId: string, asin: string): string {
  return `${orderId}-${asin || 'noasin'}`
}

/** Map one SP-API order + item pair to an orders table row. */
export function mapOrderItemToRow(order: SpOrder, item: SpOrderItem): OrdersRow | null {
  const asin = item.ASIN ?? ''
  const id = buildRowId(order.AmazonOrderId, asin)

  // Revenue: pre-tax ItemPrice for confirmed orders.
  // F12: Pending orders return empty/null ItemPrice — use OrderTotal as approximation.
  let revenueCad = 0
  if (item.ItemPrice?.Amount) {
    revenueCad = parseFloat(item.ItemPrice.Amount)
    // Subtract promotion discount from gross price
    if (item.PromotionDiscount?.Amount) {
      revenueCad -= parseFloat(item.PromotionDiscount.Amount)
    }
    revenueCad = Math.round(revenueCad * 100) / 100
  } else if (order.OrderStatus === 'Pending' && order.OrderTotal?.Amount) {
    revenueCad = Math.round(parseFloat(order.OrderTotal.Amount) * 100) / 100
  }

  const shippingCost = item.ShippingPrice?.Amount
    ? Math.round(parseFloat(item.ShippingPrice.Amount) * 100) / 100
    : 0

  const orderDate = order.PurchaseDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  const fiscalYear = parseInt(orderDate.slice(0, 4))

  return {
    id,
    product_id: null,
    marketplace: 'amazon_ca',
    order_date: orderDate,
    fiscal_year: fiscalYear,
    asin: asin || 'noasin',
    title: item.Title ?? null,
    quantity: item.QuantityOrdered,
    revenue_cad: revenueCad,
    marketplace_fees: 0,
    shipping_cost: shippingCost,
    cogs_cad: 0,
    profit_cad: null,
    currency: 'CAD',
    status: order.OrderStatus,
    person_handle: 'colin',
    _source: 'sp_api',
  }
}

// ── Core sync ─────────────────────────────────────────────────────────────────

/**
 * Fetch all orders for the given date range and upsert them into the orders table.
 *
 * - One row per order item (ASIN). id = "{orderId}-{asin}" — stable composite PK.
 * - Upserts on id conflict — safe to re-run (idempotent).
 * - Per-order failures are counted and logged but never abort the batch.
 * - dryRun=true fetches + maps but skips all DB writes (use for counting).
 */
export async function syncOrdersForRange(params: SyncParams): Promise<SyncResult> {
  const { startDate, endDate, supabase, dryRun = false } = params

  const createdAfter = dayBoundaryUTC(startDate, 'start')
  const createdBeforeTs = dayBoundaryUTC(endDate, 'end')
  // SP-API returns 400 if CreatedBefore is a future timestamp (Constraint 1, orders.ts:63).
  // Omit it when endDate is today or future so the query remains open-ended.
  const createdBefore = new Date(createdBeforeTs) > new Date() ? undefined : createdBeforeTs

  const orders = await fetchOrders({ createdAfter, createdBefore })

  let inserted = 0
  let skipped = 0
  let errors = 0

  for (const order of orders) {
    let items: SpOrderItem[]
    try {
      items = await fetchOrderItems(order.AmazonOrderId)
    } catch {
      errors++
      continue
    }

    if (items.length === 0) {
      skipped++
      continue
    }

    const rows = items
      .map((item) => mapOrderItemToRow(order, item))
      .filter((r): r is OrdersRow => r !== null)

    if (rows.length === 0) {
      skipped++
      continue
    }

    if (dryRun) {
      inserted += rows.length
      continue
    }

    const { error } = await supabase.from('orders').upsert(rows, {
      onConflict: 'id',
    })

    if (error) {
      errors++
    } else {
      inserted += rows.length
    }
  }

  return {
    fetched: orders.length,
    inserted,
    skipped,
    errors,
  }
}
