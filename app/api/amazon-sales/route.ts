import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export type WindowKey = '30d' | '60d' | '90d' | 'ytd' | 'all'

export interface DailyPoint {
  date: string
  revenue: number
  units: number
  roll7: number
  roll30: number
}

export interface RollingWindow {
  label: '7d' | '30d' | '60d' | '90d'
  total: number
  avgPerDay: number
  days: number
}

export interface DayRow {
  date: string
  revenue: number
  units: number
}

export interface SettlementRow {
  id: string
  periodStart: string
  periodEnd: string
  netPayout: number
  fundTransferStatus: string
}

export interface AmazonSalesPayload {
  window: WindowKey
  rangeStart: string | null
  rangeEnd: string | null
  kpis: {
    monthSales: number
    monthSalesPrev: number
    monthNet: number
    monthNetPrev: number
    avgPerDay: number
    bestDay: number
    bestDayDate: string | null
  }
  dailySeries: DailyPoint[]
  rollingWindows: RollingWindow[]
  topDays: DayRow[]
  bottomDays: DayRow[]
  settlements: SettlementRow[]
  monthlyAvailable: boolean
}

interface OrderRow {
  order_date: string
  revenue_cad: number | string
  quantity: number | string
}

interface SettlementRaw {
  id: string
  period_start_at: string
  period_end_at: string
  net_payout: number | string
  fund_transfer_status: string | null
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

function prevMonthStart(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return `${py}-${String(pm).padStart(2, '0')}-01`
}

function rangeStartFor(window: WindowKey): string | null {
  switch (window) {
    case '30d':
      return isoDaysAgo(30)
    case '60d':
      return isoDaysAgo(60)
    case '90d':
      return isoDaysAgo(90)
    case 'ytd': {
      const y = new Date().getUTCFullYear()
      return `${y}-01-01`
    }
    case 'all':
      return null
  }
}

function rolling(values: number[], window: number): number[] {
  const out: number[] = []
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1)
    let sum = 0
    for (let j = start; j <= i; j++) sum += values[j]
    out.push(sum / (i - start + 1))
  }
  return out
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function isWindowKey(s: string | null): s is WindowKey {
  return s === '30d' || s === '60d' || s === '90d' || s === 'ytd' || s === 'all'
}

export async function GET(request: Request) {
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const winRaw = url.searchParams.get('window')
  const window: WindowKey = isWindowKey(winRaw) ? winRaw : '90d'

  const supabase = createServiceClient()
  const today = todayIso()
  const rangeStart = rangeStartFor(window)

  let q = supabase
    .from('orders')
    .select('order_date, revenue_cad, quantity')
    .eq('marketplace', 'amazon_ca')
    .order('order_date', { ascending: true })
  if (rangeStart) q = q.gte('order_date', rangeStart)

  const { data: orders, error: oErr } = await q
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 })

  // Aggregate daily
  const byDate = new Map<string, { revenue: number; units: number }>()
  for (const o of (orders ?? []) as OrderRow[]) {
    const d = String(o.order_date).slice(0, 10)
    const cur = byDate.get(d) ?? { revenue: 0, units: 0 }
    cur.revenue += Number(o.revenue_cad) || 0
    cur.units += Number(o.quantity) || 0
    byDate.set(d, cur)
  }
  const sortedDates = Array.from(byDate.keys()).sort()
  const revenueArr = sortedDates.map((d) => byDate.get(d)!.revenue)
  const roll7 = rolling(revenueArr, 7)
  const roll30 = rolling(revenueArr, 30)
  const dailySeries: DailyPoint[] = sortedDates.map((d, i) => ({
    date: d,
    revenue: round2(byDate.get(d)!.revenue),
    units: byDate.get(d)!.units,
    roll7: round2(roll7[i]),
    roll30: round2(roll30[i]),
  }))

  // KPIs — month + prev month sales (independent of window)
  const monthStart = startOfMonth(today)
  const prevStart = prevMonthStart(today)
  const { data: monthOrders } = await supabase
    .from('orders')
    .select('order_date, revenue_cad')
    .eq('marketplace', 'amazon_ca')
    .gte('order_date', prevStart)
  let monthSales = 0
  let monthSalesPrev = 0
  for (const o of (monthOrders ?? []) as Pick<OrderRow, 'order_date' | 'revenue_cad'>[]) {
    const d = String(o.order_date).slice(0, 10)
    const r = Number(o.revenue_cad) || 0
    if (d >= monthStart) monthSales += r
    else if (d >= prevStart) monthSalesPrev += r
  }

  // Settlements — month + prev month net payout, plus full-window list
  const { data: settlementsRaw } = await supabase
    .from('amazon_settlements')
    .select('id, period_start_at, period_end_at, net_payout, fund_transfer_status')
    .eq('currency', 'CAD')
    .order('period_end_at', { ascending: true })

  let monthNet = 0
  let monthNetPrev = 0
  const settlements: SettlementRow[] = []
  for (const s of (settlementsRaw ?? []) as SettlementRaw[]) {
    const periodEnd = String(s.period_end_at).slice(0, 10)
    const np = Number(s.net_payout) || 0
    if (periodEnd >= monthStart) monthNet += np
    else if (periodEnd >= prevStart) monthNetPrev += np
    if (!rangeStart || periodEnd >= rangeStart) {
      settlements.push({
        id: s.id,
        periodStart: String(s.period_start_at).slice(0, 10),
        periodEnd,
        netPayout: round2(np),
        fundTransferStatus: s.fund_transfer_status ?? '',
      })
    }
  }

  // Avg per day + best day in window
  const days = dailySeries.length
  const totalWindow = dailySeries.reduce((s, d) => s + d.revenue, 0)
  const avgPerDay = days > 0 ? totalWindow / days : 0
  let bestDay = 0
  let bestDayDate: string | null = null
  for (const d of dailySeries) {
    if (d.revenue > bestDay) {
      bestDay = d.revenue
      bestDayDate = d.date
    }
  }

  // Rolling windows (always relative to today, independent of selected window)
  const rollingWindows: RollingWindow[] = (['7d', '30d', '60d', '90d'] as const).map((label) => {
    const n = label === '7d' ? 7 : label === '30d' ? 30 : label === '60d' ? 60 : 90
    const cutoff = isoDaysAgo(n)
    let total = 0
    let observed = 0
    for (const d of dailySeries) {
      if (d.date >= cutoff) {
        total += d.revenue
        observed++
      }
    }
    const denom = observed > 0 ? observed : 1
    return {
      label,
      total: round2(total),
      avgPerDay: round2(total / denom),
      days: observed,
    }
  })

  // Top / bottom 5 days (in window)
  const sortedByRev = [...dailySeries].sort((a, b) => b.revenue - a.revenue)
  const topDays: DayRow[] = sortedByRev.slice(0, 5).map((d) => ({
    date: d.date,
    revenue: d.revenue,
    units: d.units,
  }))
  const bottomDays: DayRow[] = sortedByRev
    .filter((d) => d.revenue > 0)
    .slice(-5)
    .reverse()
    .map((d) => ({ date: d.date, revenue: d.revenue, units: d.units }))

  const monthlyAvailable = days >= 180 // ≥6 months of order coverage

  const payload: AmazonSalesPayload = {
    window,
    rangeStart: rangeStart ?? sortedDates[0] ?? null,
    rangeEnd: today,
    kpis: {
      monthSales: round2(monthSales),
      monthSalesPrev: round2(monthSalesPrev),
      monthNet: round2(monthNet),
      monthNetPrev: round2(monthNetPrev),
      avgPerDay: round2(avgPerDay),
      bestDay: round2(bestDay),
      bestDayDate,
    },
    dailySeries,
    rollingWindows,
    topDays,
    bottomDays,
    settlements,
    monthlyAvailable,
  }
  return NextResponse.json(payload)
}
