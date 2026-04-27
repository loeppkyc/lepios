// lib/amazon/reports.ts
// Pure aggregation functions for the /amazon reports page.
// No Supabase imports — testable in isolation.
// Column names sourced from OrdersRow (lib/amazon/orders-sync.ts)
// and amazon_settlements (supabase/migrations/0036_amazon_settlements.sql).

import type { OrdersRow } from './orders-sync'

// ── External row type for settlements ────────────────────────────────────────

export interface SettlementRow {
  id: string
  period_start_at: string | null
  period_end_at: string | null
  net_payout: number | null
  gross: number | null
  fees_total: number | null
  fund_transfer_status: string | null
  currency: string
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface KpiRowData {
  totalOrders: number
  grossRevenue: number // CAD, pre-tax
  unitsShipped: number
  netPayout: number // from settlements, last 35d
  deltas: {
    totalOrders: number | null // null = no prior-period data
    grossRevenue: number | null
    unitsShipped: number | null
    netPayout: number | null // always null — no prior-period settlement delta tracked
  }
}

export interface DailyChartPoint {
  date: string // YYYY-MM-DD
  revenue: number
  units: number
}

export interface TopSellerRow {
  asin: string
  title: string
  units: number
  revenue: number
  status: string // most common status for this ASIN
}

export interface StatusBreakdownRow {
  status: string
  count: number
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Returns the date string YYYY-MM-DD for N days before `now` (inclusive of that day). */
function daysBeforeDate(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

/** Returns today's date string YYYY-MM-DD for the given `now`. */
function todayStr(now: Date): string {
  return now.toISOString().slice(0, 10)
}

// ── aggregateForKpiRow ────────────────────────────────────────────────────────

/**
 * Compute the 4 KPI values and their period-over-period deltas.
 * - Current window: last 30 days (order_date >= 30d ago through today)
 * - Prior window: 31–60 days ago
 * - Settlements window: last 35 days (by period_end_at)
 * - Delta = null when prior window has zero orders (no basis for comparison)
 * - netPayout delta is always null (no prior-period settlement comparison)
 */
export function aggregateForKpiRow(
  orders: OrdersRow[],
  settlements: SettlementRow[],
  now: Date = new Date()
): KpiRowData {
  const todayDate = todayStr(now)
  const cutoff30 = daysBeforeDate(now, 30) // start of current window (inclusive)
  const cutoff60 = daysBeforeDate(now, 60) // start of prior window (inclusive)
  const cutoff35 = daysBeforeDate(now, 35) // start of settlement window

  let curOrders = 0
  let curRevenue = 0
  let curUnits = 0
  let priorOrders = 0
  let priorRevenue = 0
  let priorUnits = 0

  for (const row of orders) {
    const d = row.order_date
    if (d >= cutoff30 && d <= todayDate) {
      curOrders++
      curRevenue += row.revenue_cad
      curUnits += row.quantity
    } else if (d >= cutoff60 && d < cutoff30) {
      priorOrders++
      priorRevenue += row.revenue_cad
      priorUnits += row.quantity
    }
  }

  // Round to 2dp
  curRevenue = Math.round(curRevenue * 100) / 100
  priorRevenue = Math.round(priorRevenue * 100) / 100

  // Deltas: null when prior window is empty (no data to compare against)
  const hasPrior = priorOrders > 0 || priorRevenue > 0
  const deltas = {
    totalOrders: hasPrior ? curOrders - priorOrders : null,
    grossRevenue: hasPrior ? Math.round((curRevenue - priorRevenue) * 100) / 100 : null,
    unitsShipped: hasPrior ? curUnits - priorUnits : null,
    netPayout: null as number | null,
  }

  // Net payout from settlements — last 35 days by period_end_at
  let netPayout = 0
  for (const s of settlements) {
    if (!s.period_end_at) continue
    const endDate = s.period_end_at.slice(0, 10)
    if (endDate >= cutoff35 && endDate <= todayDate) {
      netPayout += s.net_payout ?? 0
    }
  }
  netPayout = Math.round(netPayout * 100) / 100

  return {
    totalOrders: curOrders,
    grossRevenue: curRevenue,
    unitsShipped: curUnits,
    netPayout,
    deltas,
  }
}

// ── aggregateForDailyChart ────────────────────────────────────────────────────

/**
 * Build exactly 30 data points (one per day, oldest first, most recent last).
 * Days with no orders have revenue=0, units=0.
 * Orders outside the 30-day window are excluded.
 */
export function aggregateForDailyChart(
  orders: OrdersRow[],
  now: Date = new Date()
): DailyChartPoint[] {
  const todayDate = todayStr(now)
  const cutoff30 = daysBeforeDate(now, 29) // 29 days back = 30 entries total (day 0 to day 29)

  // Build a map: date → { revenue, units }
  const map = new Map<string, { revenue: number; units: number }>()
  for (const row of orders) {
    const d = row.order_date
    if (d < cutoff30 || d > todayDate) continue
    const existing = map.get(d) ?? { revenue: 0, units: 0 }
    map.set(d, {
      revenue: existing.revenue + row.revenue_cad,
      units: existing.units + row.quantity,
    })
  }

  // Generate all 30 days
  const points: DailyChartPoint[] = []
  for (let i = 29; i >= 0; i--) {
    const date = daysBeforeDate(now, i)
    const agg = map.get(date)
    points.push({
      date,
      revenue: agg ? Math.round(agg.revenue * 100) / 100 : 0,
      units: agg?.units ?? 0,
    })
  }

  return points
}

// ── aggregateForTopSellers ────────────────────────────────────────────────────

/**
 * Returns top 10 ASINs by revenue in the last 30 days.
 * Ties broken by ASIN ascending.
 * Multiple rows for the same ASIN are aggregated.
 * Most-common status determined by frequency.
 */
export function aggregateForTopSellers(
  orders: OrdersRow[],
  now: Date = new Date()
): TopSellerRow[] {
  const todayDate = todayStr(now)
  const cutoff30 = daysBeforeDate(now, 30)

  // Aggregate per ASIN
  const map = new Map<
    string,
    { title: string; units: number; revenue: number; statusCounts: Map<string, number> }
  >()

  for (const row of orders) {
    if (row.order_date < cutoff30 || row.order_date > todayDate) continue
    const existing = map.get(row.asin)
    if (!existing) {
      const statusCounts = new Map<string, number>()
      statusCounts.set(row.status, 1)
      map.set(row.asin, {
        title: row.title ?? row.asin,
        units: row.quantity,
        revenue: row.revenue_cad,
        statusCounts,
      })
    } else {
      existing.units += row.quantity
      existing.revenue += row.revenue_cad
      existing.statusCounts.set(row.status, (existing.statusCounts.get(row.status) ?? 0) + 1)
      // Update title to latest non-null value
      if (row.title && !existing.title) {
        existing.title = row.title
      }
    }
  }

  // Convert to array, determine most-common status
  const rows: TopSellerRow[] = []
  for (const [asin, data] of map) {
    let topStatus = ''
    let topCount = 0
    for (const [status, count] of data.statusCounts) {
      if (count > topCount) {
        topCount = count
        topStatus = status
      }
    }
    rows.push({
      asin,
      title: data.title,
      units: data.units,
      revenue: Math.round(data.revenue * 100) / 100,
      status: topStatus,
    })
  }

  // Sort: revenue desc, then ASIN asc as tiebreaker
  rows.sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue
    return a.asin.localeCompare(b.asin)
  })

  return rows.slice(0, 10)
}

// ── aggregateForStatusBreakdown ───────────────────────────────────────────────

/**
 * Returns count per order status in the last 30 days, sorted by count descending.
 */
export function aggregateForStatusBreakdown(
  orders: OrdersRow[],
  now: Date = new Date()
): StatusBreakdownRow[] {
  const todayDate = todayStr(now)
  const cutoff30 = daysBeforeDate(now, 30)

  const map = new Map<string, number>()
  for (const row of orders) {
    if (row.order_date < cutoff30 || row.order_date > todayDate) continue
    map.set(row.status, (map.get(row.status) ?? 0) + 1)
  }

  const rows: StatusBreakdownRow[] = []
  for (const [status, count] of map) {
    rows.push({ status, count })
  }

  // Sort by count desc
  rows.sort((a, b) => b.count - a.count)
  return rows
}
