import { spFetch } from './client'

const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'

// All five statuses fetched in one call per acceptance doc Constraint 0.
// Route handler splits them: confirmed = all except Pending; Pending drives indicator only.
const ALL_ORDER_STATUSES = 'Unshipped,PartiallyShipped,Shipped,Canceled,Pending'

export type OrderStatus = 'Unshipped' | 'PartiallyShipped' | 'Shipped' | 'Canceled' | 'Pending'

export interface SpOrder {
  AmazonOrderId: string
  OrderStatus: OrderStatus
  // OrderTotal includes tax — do NOT use for revenue. Use ItemPrice from order items.
  OrderTotal?: {
    Amount: string
    CurrencyCode: string
  }
  NumberOfItemsShipped?: number
  NumberOfItemsUnshipped?: number
  // ISO-8601 UTC timestamp e.g. "2026-04-22T18:30:00Z"
  PurchaseDate?: string
}

export interface SpOrderItem {
  OrderItemId: string
  ASIN?: string
  Title?: string
  QuantityOrdered: number
  // Pre-tax item price — the correct revenue field (Principle 6)
  ItemPrice?: { Amount: string; CurrencyCode: string }
  // Excluded from revenue: tax passes through to CRA
  ItemTax?: { Amount: string; CurrencyCode: string }
  ShippingPrice?: { Amount: string; CurrencyCode: string }
  ShippingTax?: { Amount: string; CurrencyCode: string }
  PromotionDiscount?: { Amount: string; CurrencyCode: string }
}

interface OrderItemsResponse {
  payload?: {
    OrderItems?: SpOrderItem[]
    NextToken?: string
  }
}

interface OrdersPageResponse {
  payload?: {
    Orders?: SpOrder[]
    NextToken?: string
  }
}

export interface FetchOrdersParams {
  /** ISO-8601 UTC timestamp — today at midnight Edmonton time */
  createdAfter: string
  /** ISO-8601 UTC timestamp — only safe to pass for fully-past windows (Yesterday) */
  createdBefore?: string
}

/**
 * Fetch all orders for a day window from SP-API.
 *
 * Constraint 1 (CreatedBefore future-date rule): createdBefore must be omitted
 * for Today queries. Passing a future timestamp returns HTTP 400. Callers must
 * branch on this; this function honours whatever is passed.
 *
 * Constraint 4 (Pagination): follows NextToken until exhausted.
 *
 * @returns All orders (all five statuses). Callers split confirmed vs. Pending.
 */
export async function fetchOrders(params: FetchOrdersParams): Promise<SpOrder[]> {
  const orders: SpOrder[] = []

  // Initial request params
  const baseParams: Record<string, string> = {
    MarketplaceIds: MARKETPLACE_CA,
    OrderStatuses: ALL_ORDER_STATUSES,
    CreatedAfter: params.createdAfter,
  }
  if (params.createdBefore !== undefined) {
    baseParams.CreatedBefore = params.createdBefore
  }

  let currentParams: Record<string, string> = baseParams

  // Paginate until no NextToken
  while (true) {
    const data = await spFetch<OrdersPageResponse>('/orders/v0/orders', {
      method: 'GET',
      params: currentParams,
    })

    const page = data.payload?.Orders ?? []
    orders.push(...page)

    const nextToken = data.payload?.NextToken
    if (!nextToken) break

    // NextToken replaces all other params on subsequent pages
    currentParams = { NextToken: nextToken }
  }

  return orders
}

/**
 * Fetch all items for a single order.
 * Used to get pre-tax ItemPrice.Amount — OrderTotal includes tax and must not
 * be used for revenue (grounding failure: $4.20 tax on BC buyer, 12% rate).
 */
export async function fetchOrderItems(orderId: string): Promise<SpOrderItem[]> {
  const items: SpOrderItem[] = []
  let params: Record<string, string> = {}

  while (true) {
    const data = await spFetch<OrderItemsResponse>(
      `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`,
      { method: 'GET', params: Object.keys(params).length ? params : undefined }
    )
    items.push(...(data.payload?.OrderItems ?? []))
    const next = data.payload?.NextToken
    if (!next) break
    params = { NextToken: next }
  }

  return items
}

// ── Day-boundary helpers (Edmonton = America/Edmonton) ────────────────────────

/** Returns ISO-8601 UTC string for today at midnight Edmonton time. */
export function todayMidnightEdmontonUTC(): string {
  return dayBoundaryUTC(new Date(), 'start')
}

/** Returns ISO-8601 UTC string for yesterday at midnight Edmonton time (start). */
export function yesterdayMidnightEdmontonUTC(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return dayBoundaryUTC(d, 'start')
}

/** Returns ISO-8601 UTC string for yesterday at 23:59:59.999 Edmonton time (end). */
export function yesterdayEndEdmontonUTC(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return dayBoundaryUTC(d, 'end')
}

/**
 * Compute the UTC equivalent of midnight (start) or 23:59:59.999 (end) for a
 * given date in the America/Edmonton timezone.
 *
 * Uses an explicit ISO offset string ("2026-04-22T00:00:00.000-06:00") so the
 * result is server-timezone-independent — correct on Vercel (UTC) and local
 * machines alike. The offset is derived from localDate via Intl, so MST/MDT
 * is handled automatically without hardcoding.
 */
export function dayBoundaryUTC(localDate: Date, boundary: 'start' | 'end'): string {
  // Get year/month/day as seen in Edmonton at this UTC moment
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

  // Compute UTC offset for Edmonton at this moment (positive = UTC ahead of Edmonton)
  // e.g. MDT: UTC is 6h ahead of Edmonton → offsetHours = 6
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
  // Edmonton is UTC-offsetHours → ISO offset string is "-HH:00"
  const offsetStr = `-${pad2(offsetHours)}:00`

  // Build unambiguous ISO string with explicit timezone offset.
  // JavaScript's Date parser treats "T00:00:00.000-06:00" as Edmonton midnight,
  // regardless of the server's local timezone.
  const timeStr = boundary === 'start' ? 'T00:00:00.000' : 'T23:59:59.999'
  return new Date(`${year}-${pad2(month)}-${pad2(day)}${timeStr}${offsetStr}`).toISOString()
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

// ── Aggregation ───────────────────────────────────────────────────────────────

export type ConfirmedStatus = 'Unshipped' | 'PartiallyShipped' | 'Shipped' | 'Canceled'

const CONFIRMED_STATUSES = new Set<OrderStatus>([
  'Unshipped',
  'PartiallyShipped',
  'Shipped',
  'Canceled',
])

export interface DayPanelData {
  /** Count of confirmed orders (Unshipped + PartiallyShipped + Shipped + Canceled) */
  confirmedCount: number
  /** Sum of ItemPrice.Amount across confirmed orders (CAD, pre-tax) */
  revenueCad: number
  /** Sum of ItemTax.Amount + ShippingTax.Amount across confirmed orders — v0 infra for LepiOS tax/GST module */
  taxCad: number
  /** Sum of NumberOfItemsShipped + NumberOfItemsUnshipped across confirmed orders */
  unitsSold: number
  /** Count of Pending orders */
  pendingCount: number
  /** Sum of NumberOfItemsShipped + NumberOfItemsUnshipped across Pending orders */
  pendingUnits: number
}

/**
 * Aggregate orders into panel data.
 *
 * itemFinanceMap: orderId → { revenue, tax } fetched from /orderItems.
 * revenue = sum(ItemPrice.Amount) — pre-tax item price (correct revenue field).
 * tax = sum(ItemTax.Amount + ShippingTax.Amount) — captured for LepiOS tax/GST module.
 * OrderTotal.Amount must NOT be used — includes provincial tax (grounding failure: $4.20
 * BC tax at 12% inflated revenue on grounding check).
 * Pending orders are excluded from both revenue and tax.
 */
export function aggregateOrders(
  orders: SpOrder[],
  itemFinanceMap: Map<string, { revenue: number; tax: number }>
): DayPanelData {
  let confirmedCount = 0
  let revenueCad = 0
  let taxCad = 0
  let unitsSold = 0
  let pendingCount = 0
  let pendingUnits = 0

  for (const order of orders) {
    if (order.OrderStatus === 'Pending') {
      pendingCount++
      pendingUnits += (order.NumberOfItemsShipped ?? 0) + (order.NumberOfItemsUnshipped ?? 0)
      continue
    }
    if (CONFIRMED_STATUSES.has(order.OrderStatus)) {
      confirmedCount++
      const finance = itemFinanceMap.get(order.AmazonOrderId) ?? { revenue: 0, tax: 0 }
      revenueCad += finance.revenue
      taxCad += finance.tax
      unitsSold += (order.NumberOfItemsShipped ?? 0) + (order.NumberOfItemsUnshipped ?? 0)
    }
  }

  revenueCad = Math.round(revenueCad * 100) / 100
  taxCad = Math.round(taxCad * 100) / 100
  return { confirmedCount, revenueCad, taxCad, unitsSold, pendingCount, pendingUnits }
}
