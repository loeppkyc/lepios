import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ZERO_GST_CATEGORIES } from '@/lib/types/expenses'

const GST_RATE = 0.05

function periodDateRange(year: number, quarter: number | null): { start: string; end: string } {
  if (quarter === null) {
    return { start: `${year}-01-01`, end: `${year}-12-31` }
  }
  const quarters = [
    { start: `${year}-01-01`, end: `${year}-03-31` },
    { start: `${year}-04-01`, end: `${year}-06-30` },
    { start: `${year}-07-01`, end: `${year}-09-30` },
    { start: `${year}-10-01`, end: `${year}-12-31` },
  ]
  return quarters[quarter - 1]
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const yearStr = searchParams.get('year')
  const quarterStr = searchParams.get('quarter')

  if (!yearStr || !/^\d{4}$/.test(yearStr)) {
    return NextResponse.json({ error: 'year required (YYYY)' }, { status: 400 })
  }
  const year = parseInt(yearStr, 10)

  let quarter: number | null = null
  if (quarterStr !== null && quarterStr !== '') {
    const q = parseInt(quarterStr, 10)
    if (isNaN(q) || q < 1 || q > 4) {
      return NextResponse.json({ error: 'quarter must be 1–4' }, { status: 400 })
    }
    quarter = q
  }

  const { start, end } = periodDateRange(year, quarter)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Revenue: amazon_settlements bucketed by period_end_at
  // gross is deferred/null in current schema — using net_payout as revenue proxy
  const { data: settlements, error: settErr } = await supabase
    .from('amazon_settlements')
    .select('id, net_payout, period_start_at, period_end_at')
    .gte('period_end_at', `${start}T00:00:00+00:00`)
    .lte('period_end_at', `${end}T23:59:59+00:00`)
    .order('period_end_at', { ascending: true })

  if (settErr) return NextResponse.json({ error: settErr.message }, { status: 500 })

  // All expenses in period — zero-GST filtering done in JS to avoid PostgREST
  // special-char escaping issues with em-dash category names
  const { data: expenses, error: expErr } = await supabase
    .from('business_expenses')
    .select('id, tax_amount, category, pretax')
    .gte('date', start)
    .lte('date', end)

  if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 })

  const allExpenses = expenses ?? []
  const gstEligible = allExpenses.filter((e) => !ZERO_GST_CATEGORIES.has(e.category))
  const zeroRated = allExpenses.filter((e) => ZERO_GST_CATEGORIES.has(e.category))

  const revenue = (settlements ?? []).reduce((sum, s) => sum + (Number(s.net_payout) || 0), 0)
  // GST estimate on revenue: Amazon typically collects & remits GST on marketplace
  // sales as the deemed supplier — confirm with accountant before filing
  const gstOnRevenue = revenue * GST_RATE

  const itcs = gstEligible.reduce((sum, e) => sum + (Number(e.tax_amount) || 0), 0)
  const netTax = gstOnRevenue - itcs

  return NextResponse.json({
    period: { year, quarter, start, end },
    // Line 101: total sales (using net_payout — gross is deferred)
    revenue: round2(revenue),
    // Estimated GST collected on revenue (may be $0 if Amazon remits on your behalf)
    gstOnRevenue: round2(gstOnRevenue),
    // Line 106: input tax credits from GST-eligible business expenses
    line106Itcs: round2(itcs),
    // Line 109: net tax remittable (negative = refund)
    line109NetTax: round2(netTax),
    settlementCount: (settlements ?? []).length,
    expenseCount: allExpenses.length,
    gstEligibleCount: gstEligible.length,
    zeroRatedCount: zeroRated.length,
    gstEligiblePretax: round2(gstEligible.reduce((sum, e) => sum + (Number(e.pretax) || 0), 0)),
    zeroRatedPretax: round2(zeroRated.reduce((sum, e) => sum + (Number(e.pretax) || 0), 0)),
  })
}
