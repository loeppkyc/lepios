import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Costs directly tied to producing Amazon revenue
const COGS_CATEGORIES = new Set([
  'Inventory — Books (Pallets)',
  'Inventory — Other',
  'Shipping & Delivery',
])

const r2 = (n: number) => Math.round(n * 100) / 100

export interface MonthlyPnlRow {
  month: string // 'YYYY-MM'
  revenue: number
  cogs: number
  grossProfit: number
  opex: number
  netProfit: number
}

export interface CategoryPnlRow {
  category: string
  total: number
  isCogs: boolean
}

export interface PnlResponse {
  year: number
  months: MonthlyPnlRow[]
  categories: CategoryPnlRow[]
  totals: {
    revenue: number
    cogs: number
    grossProfit: number
    opex: number
    netProfit: number
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const yearStr = searchParams.get('year')

  if (!yearStr || !/^\d{4}$/.test(yearStr)) {
    return NextResponse.json({ error: 'year required (YYYY)' }, { status: 400 })
  }
  const year = parseInt(yearStr, 10)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Revenue: settlements bucketed by period_end_at month
  // net_payout = actual cash received; gross is deferred in current schema
  const { data: settlements, error: settErr } = await supabase
    .from('amazon_settlements')
    .select('net_payout, period_end_at')
    .gte('period_end_at', `${year}-01-01T00:00:00+00:00`)
    .lte('period_end_at', `${year}-12-31T23:59:59+00:00`)

  if (settErr) return NextResponse.json({ error: settErr.message }, { status: 500 })

  const { data: expenses, error: expErr } = await supabase
    .from('business_expenses')
    .select('date, category, pretax')
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)

  if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 })

  // Initialize 12 monthly buckets
  const rev: Record<string, number> = {}
  const cogs: Record<string, number> = {}
  const opex: Record<string, number> = {}
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`
    rev[key] = 0
    cogs[key] = 0
    opex[key] = 0
  }

  for (const s of settlements ?? []) {
    const month = (s.period_end_at as string).slice(0, 7)
    if (month in rev) rev[month] += Number(s.net_payout) || 0
  }

  const categoryTotals: Record<string, number> = {}
  for (const e of expenses ?? []) {
    const month = (e.date as string).slice(0, 7)
    const pretax = Number(e.pretax) || 0
    if (COGS_CATEGORIES.has(e.category)) {
      cogs[month] = (cogs[month] ?? 0) + pretax
    } else {
      opex[month] = (opex[month] ?? 0) + pretax
    }
    categoryTotals[e.category] = (categoryTotals[e.category] ?? 0) + pretax
  }

  const months: MonthlyPnlRow[] = Object.keys(rev)
    .sort()
    .map((month) => {
      const revenue = r2(rev[month])
      const cogsAmt = r2(cogs[month] ?? 0)
      const opexAmt = r2(opex[month] ?? 0)
      const grossProfit = r2(revenue - cogsAmt)
      const netProfit = r2(grossProfit - opexAmt)
      return { month, revenue, cogs: cogsAmt, grossProfit, opex: opexAmt, netProfit }
    })

  const categories: CategoryPnlRow[] = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([category, total]) => ({
      category,
      total: r2(total),
      isCogs: COGS_CATEGORIES.has(category),
    }))

  const totals = months.reduce(
    (acc, m) => ({
      revenue: acc.revenue + m.revenue,
      cogs: acc.cogs + m.cogs,
      grossProfit: acc.grossProfit + m.grossProfit,
      opex: acc.opex + m.opex,
      netProfit: acc.netProfit + m.netProfit,
    }),
    { revenue: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0 }
  )

  const body: PnlResponse = {
    year,
    months,
    categories,
    totals: {
      revenue: r2(totals.revenue),
      cogs: r2(totals.cogs),
      grossProfit: r2(totals.grossProfit),
      opex: r2(totals.opex),
      netProfit: r2(totals.netProfit),
    },
  }

  return NextResponse.json(body)
}
