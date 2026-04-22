import { spFetch } from './client'

const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'

// All five statuses fetched in one call per acceptance doc Constraint 0.
// Route handler splits them: confirmed = all except Pending; Pending drives indicator only.
const ALL_ORDER_STATUSES = 'Unshipped,PartiallyShipped,Shipped,Canceled,Pending'

export type OrderStatus = 'Unshipped' | 'PartiallyShipped' | 'Shipped' | 'Canceled' | 'Pending'

export interface SpOrder {
  AmazonOrderId: string
  OrderStatus: OrderStatus
  OrderTotal?: {
    Amount: string
    CurrencyCode: string
  }
  NumberOfItemsShipped?: number
  NumberOfItemsUnshipped?: number
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
 * Relies on Intl.DateTimeFormat to discover the UTC offset at the given moment
 * rather than hardcoding -6 or -7, so it handles MST/MDT automatically.
 */
function dayBoundaryUTC(localDate: Date, boundary: 'start' | 'end'): string {
  // Get year/month/day as seen in Edmonton
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(localDate)
  const year = Number(parts.find((p) => p.type === 'year')!.value)
  const month = Number(parts.find((p) => p.type === 'month')!.value)
  const day = Number(parts.find((p) => p.type === 'day')!.value)

  // Build the boundary moment in Edmonton local time, then get its UTC equivalent
  if (boundary === 'start') {
    // midnight Edmonton
    const edmontonMidnight = new Date(`${year}-${pad2(month)}-${pad2(day)}T00:00:00`)
    const offsetMs = edmontonMidnightOffsetMs(edmontonMidnight)
    const utcMs = edmontonMidnight.getTime() - offsetMs
    return new Date(utcMs).toISOString()
  } else {
    // 23:59:59.999 Edmonton
    const edmontonEndOfDay = new Date(`${year}-${pad2(month)}-${pad2(day)}T23:59:59.999`)
    const offsetMs = edmontonMidnightOffsetMs(edmontonEndOfDay)
    const utcMs = edmontonEndOfDay.getTime() - offsetMs
    return new Date(utcMs).toISOString()
  }
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * Returns the Edmonton UTC offset in milliseconds for a given date.
 * Uses Intl to detect MST (-7h) vs MDT (-6h) automatically.
 */
function edmontonMidnightOffsetMs(date: Date): number {
  // Format the date in UTC and in Edmonton; compare the hour difference
  const utcHour = Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      hour: '2-digit',
      hour12: false,
    }).format(date)
  )
  const edHour = Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Edmonton',
      hour: '2-digit',
      hour12: false,
    }).format(date)
  )
  // offset = UTC - local (in hours), convert to ms
  let offsetHours = utcHour - edHour
  if (offsetHours < 0) offsetHours += 24
  return offsetHours * 60 * 60 * 1000
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
  /** Sum of OrderTotal.Amount across confirmed orders (CAD) */
  revenueCad: number
  /** Sum of NumberOfItemsShipped + NumberOfItemsUnshipped across confirmed orders */
  unitsSold: number
  /** Count of Pending orders — drives indicator only, not headline numbers */
  pendingCount: number
}

export function aggregateOrders(orders: SpOrder[]): DayPanelData {
  let confirmedCount = 0
  let revenueCad = 0
  let unitsSold = 0
  let pendingCount = 0

  for (const order of orders) {
    if (order.OrderStatus === 'Pending') {
      pendingCount++
      continue
    }
    if (CONFIRMED_STATUSES.has(order.OrderStatus)) {
      confirmedCount++
      // Constraint 3: revenue from OrderTotal.Amount
      const amount = parseFloat(order.OrderTotal?.Amount ?? '0')
      if (!isNaN(amount)) revenueCad += amount
      // Constraint 3: units = shipped + unshipped
      unitsSold += (order.NumberOfItemsShipped ?? 0) + (order.NumberOfItemsUnshipped ?? 0)
    }
  }

  // Round revenue to 2dp to avoid floating-point drift
  revenueCad = Math.round(revenueCad * 100) / 100

  return { confirmedCount, revenueCad, unitsSold, pendingCount }
}
