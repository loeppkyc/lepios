import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

// Categories likely to contain recurring subscriptions
const SUBSCRIPTION_CATEGORIES = [
  'Software Subscriptions',
  'Cell phone costs',
  'Storage Unit expense',
  'Insurance Costs',
  'SOFTWARE',
]

export interface SubscriptionRow {
  vendor: string
  category: string
  hits: number // number of times charged in 2026
  monthlyAvg: number
  ytdTotal: number
  lastChargeDate: string
  monthlyEstimate: number // best estimate of monthly cost (uses last 3 charges)
  status: 'active' | 'stale' // stale = not charged in last 35 days
}

export interface SubscriptionsResponse {
  subscriptions: SubscriptionRow[]
  totalMonthlyEstimate: number
  totalAnnualEstimate: number
  ytdTotal: number
  staleCount: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('business_expenses')
    .select('date, vendor, category, pretax')
    .gte('date', '2026-01-01')
    .in('category', SUBSCRIPTION_CATEGORIES)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by vendor + category
  const groupMap = new Map<
    string,
    { vendor: string; category: string; charges: { date: string; amount: number }[] }
  >()
  for (const row of data ?? []) {
    const vendor = (row.vendor ?? 'Unknown').trim()
    if (!vendor || vendor === 'Unknown') continue
    const key = `${vendor}|${row.category}`
    if (!groupMap.has(key)) {
      groupMap.set(key, { vendor, category: row.category as string, charges: [] })
    }
    groupMap.get(key)!.charges.push({
      date: row.date as string,
      amount: Number(row.pretax) || 0,
    })
  }

  const today = new Date().toISOString().slice(0, 10)
  const cutoff = (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 35)
    return d.toISOString().slice(0, 10)
  })()

  const subs: SubscriptionRow[] = []
  for (const g of groupMap.values()) {
    if (g.charges.length === 0) continue
    g.charges.sort((a, b) => a.date.localeCompare(b.date))
    const ytd = g.charges.reduce((s, c) => s + c.amount, 0)
    // Use last 3 charges as the best monthly estimate (more recent = more relevant)
    const recent = g.charges.slice(-3)
    const recentAvg = recent.reduce((s, c) => s + c.amount, 0) / recent.length
    const monthCount = Math.max(1, g.charges.length)
    const monthlyAvg = ytd / monthCount
    const lastDate = g.charges[g.charges.length - 1].date
    subs.push({
      vendor: g.vendor,
      category: g.category,
      hits: g.charges.length,
      monthlyAvg: r2(monthlyAvg),
      ytdTotal: r2(ytd),
      lastChargeDate: lastDate,
      monthlyEstimate: r2(recentAvg),
      status: lastDate >= cutoff ? 'active' : 'stale',
    })
  }

  // Sort by monthlyEstimate descending
  subs.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate)

  const activeSubs = subs.filter((s) => s.status === 'active')
  const totalMonthlyEstimate = r2(activeSubs.reduce((s, x) => s + x.monthlyEstimate, 0))
  const totalAnnualEstimate = r2(totalMonthlyEstimate * 12)
  const ytdTotal = r2(subs.reduce((s, x) => s + x.ytdTotal, 0))
  const staleCount = subs.filter((s) => s.status === 'stale').length

  void today
  return NextResponse.json({
    subscriptions: subs,
    totalMonthlyEstimate,
    totalAnnualEstimate,
    ytdTotal,
    staleCount,
  } satisfies SubscriptionsResponse)
}
