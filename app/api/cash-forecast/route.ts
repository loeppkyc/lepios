import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface ForecastPoint {
  daysOut: number
  date: string
  projectedCash: number
  projectedNetWorth: number
}

export interface CashForecastResponse {
  currentCash: number
  currentNetWorth: number
  // Monthly inflow estimate (avg recent Amazon settlements)
  monthlyInflowEstimate: number
  // Monthly outflow estimate (avg recent business expenses + recurring)
  monthlyOutflowEstimate: number
  monthlyNetCashFlow: number
  forecast: ForecastPoint[]
  notes: string[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Current cash = sum of bank/cash asset rows
  const { data: bsRows, error: bsErr } = await supabase
    .from('balance_sheet_entries')
    .select('account_type, category, balance')
    .in('account_type', ['asset', 'liability'])

  if (bsErr) return NextResponse.json({ error: bsErr.message }, { status: 500 })

  let currentCash = 0
  let totalAssets = 0
  let totalLiab = 0
  for (const r of bsRows ?? []) {
    const bal = Number(r.balance)
    if (r.account_type === 'asset') {
      totalAssets += bal
      // "Cash" = bank, personal_bank, cash categories
      const cat = r.category as string
      if (cat === 'bank' || cat === 'personal_bank' || cat === 'cash') {
        currentCash += bal
      }
    } else {
      totalLiab += bal
    }
  }
  const currentNetWorth = r2(totalAssets - totalLiab)

  // Recent inflow: avg of last 3 months of Amazon settlements
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90)
  const cutoff = ninetyDaysAgo.toISOString()

  const { data: settlements } = await supabase
    .from('amazon_settlements')
    .select('net_payout, period_end_at')
    .gte('period_end_at', cutoff)

  const inflowSum = (settlements ?? []).reduce((s, x) => s + (Number(x.net_payout) || 0), 0)
  const monthlyInflowEstimate = r2(inflowSum / 3) // last ~90 days = 3 months

  // Recent outflow: avg of last 3 months of business_expenses
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setUTCMonth(threeMonthsAgo.getUTCMonth() - 3)
  const expCutoff = threeMonthsAgo.toISOString().slice(0, 10)

  const { data: expenses } = await supabase
    .from('business_expenses')
    .select('pretax, date')
    .gte('date', expCutoff)

  const outflowSum = (expenses ?? []).reduce((s, x) => s + (Number(x.pretax) || 0), 0)
  const monthlyOutflowEstimate = r2(outflowSum / 3)

  const monthlyNetCashFlow = r2(monthlyInflowEstimate - monthlyOutflowEstimate)

  // Build forecast points: 0, 30, 60, 90 days
  const forecast: ForecastPoint[] = [0, 30, 60, 90].map((daysOut) => {
    const months = daysOut / 30
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + daysOut)
    const projectedCash = r2(currentCash + monthlyNetCashFlow * months)
    const projectedNetWorth = r2(currentNetWorth + monthlyNetCashFlow * months)
    return {
      daysOut,
      date: d.toISOString().slice(0, 10),
      projectedCash,
      projectedNetWorth,
    }
  })

  const notes: string[] = []
  if (monthlyInflowEstimate === 0) {
    notes.push('No recent Amazon settlements found — inflow estimate is $0.')
  }
  if (monthlyOutflowEstimate === 0) {
    notes.push('No recent business expenses found — outflow estimate is $0.')
  }
  if (monthlyNetCashFlow < 0) {
    notes.push(
      `At current burn rate (${r2(Math.abs(monthlyNetCashFlow))}/mo net negative), cash drops over time. Consider reducing OpEx or increasing inflow.`
    )
  }
  notes.push(
    'Forecast assumes constant inflow/outflow at the 3-month average. Inventory drawdown not modeled (book sales are recognized in COGS, not separately here).'
  )

  return NextResponse.json({
    currentCash: r2(currentCash),
    currentNetWorth,
    monthlyInflowEstimate,
    monthlyOutflowEstimate,
    monthlyNetCashFlow,
    forecast,
    notes,
  } satisfies CashForecastResponse)
}
