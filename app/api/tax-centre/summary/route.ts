import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ZERO_GST_CATEGORIES } from '@/lib/types/expenses'
import type { BusinessExpense } from '@/lib/types/expenses'

export const revalidate = 0

interface QuarterSummary {
  q: number
  label: string
  months: number[]
  itc: number
  pretax: number
  businessPortion: number
  count: number
}

interface T2125Line {
  line: string
  label: string
  categories: string[]
  pretax: number
  businessPortion: number
  count: number
}

export type QuarterStatus = 'complete' | 'in_progress' | 'needs_attention' | 'upcoming'

export interface QuarterReadiness {
  q: number
  label: string
  status: QuarterStatus
  revenue: number
  settlementCount: number
  expenseCount: number
  uncategorizedCount: number
  mileageTrips: number
  mileageKm: number
  hasStarted: boolean
  hasEnded: boolean
}

export interface TaxSummaryResponse {
  year: number
  quarters: QuarterSummary[]
  ytd: { itc: number; pretax: number; businessPortion: number; count: number }
  t2125: T2125Line[]
  loanRepaymentPretax: number
  zeroGstExpenses: number
  quarterReadiness: QuarterReadiness[]
}

const QUARTERS: Pick<QuarterSummary, 'q' | 'label' | 'months'>[] = [
  { q: 1, label: 'Q1 (Jan–Mar)', months: [1, 2, 3] },
  { q: 2, label: 'Q2 (Apr–Jun)', months: [4, 5, 6] },
  { q: 3, label: 'Q3 (Jul–Sep)', months: [7, 8, 9] },
  { q: 4, label: 'Q4 (Oct–Dec)', months: [10, 11, 12] },
]

const T2125_MAP: Array<{ line: string; label: string; categories: string[] }> = [
  {
    line: '8519',
    label: 'Cost of Goods Sold',
    categories: ['Inventory — Books (Pallets)', 'Inventory — Other'],
  },
  { line: '8521', label: 'Advertising', categories: ['Amazon Advertising'] },
  { line: '8690', label: 'Insurance', categories: ['Insurance'] },
  { line: '8710', label: 'Interest & Bank Charges', categories: ['Bank Charges'] },
  {
    line: '8760',
    label: 'Office Expenses',
    categories: ['Phone & Internet', 'Office Supplies', 'Licenses & Permits'],
  },
  {
    line: '8810',
    label: 'Professional Fees',
    categories: ['Professional Fees', 'Subcontractors'],
  },
  {
    line: '9060',
    label: 'Motor Vehicle Expenses',
    categories: [
      'Vehicle Expenses',
      'Vehicle & Travel',
      'Vehicle — Fuel',
      'Vehicle — Parking',
      'Vehicle — Repairs & Maintenance',
      'Vehicle — Tesla Charging',
    ],
  },
  {
    line: '9270',
    label: 'Other Expenses',
    categories: ['Software & Subscriptions', 'Shipping & Delivery', 'Other Business Expense'],
  },
]

const LOAN_CATEGORIES = new Set(['Loan Repayment — BDC', 'Loan Repayment — Tesla'])

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function getMonth(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getMonth() + 1
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const yearStr = searchParams.get('year')
  const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear()

  if (isNaN(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: 'year param required (YYYY)' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [expensesResult, settlementsResult, mileageResult] = await Promise.all([
    supabase
      .from('business_expenses')
      .select('*')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .order('date', { ascending: true }),
    supabase
      .from('amazon_settlements')
      .select('period_end_at, net_payout')
      .gte('period_end_at', `${year}-01-01`)
      .lte('period_end_at', `${year}-12-31`),
    supabase
      .from('mileage_log')
      .select('date, km, round_trip')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`),
  ])

  if (expensesResult.error) {
    return NextResponse.json({ error: expensesResult.error.message }, { status: 500 })
  }

  const expenses = (expensesResult.data ?? []) as BusinessExpense[]

  // Build quarter → expenses map
  const quarterMap = new Map<number, BusinessExpense[]>()
  for (const q of QUARTERS) quarterMap.set(q.q, [])

  let zeroGstCount = 0
  let loanRepaymentPretax = 0

  for (const exp of expenses) {
    const month = getMonth(exp.date)
    const q = QUARTERS.find((qq) => qq.months.includes(month))
    if (q) quarterMap.get(q.q)!.push(exp)
    if (ZERO_GST_CATEGORIES.has(exp.category)) zeroGstCount++
    if (LOAN_CATEGORIES.has(exp.category)) loanRepaymentPretax += exp.pretax
  }

  // Group settlements by quarter
  const settlementsByQ = new Map<number, { count: number; revenue: number }>()
  for (const s of (settlementsResult.data ?? []) as Array<{
    period_end_at: string
    net_payout: number
  }>) {
    const month = getMonth(s.period_end_at)
    const q = QUARTERS.find((qq) => qq.months.includes(month))
    if (!q) continue
    const cur = settlementsByQ.get(q.q) ?? { count: 0, revenue: 0 }
    cur.count++
    cur.revenue += s.net_payout
    settlementsByQ.set(q.q, cur)
  }

  // Group mileage by quarter
  const mileageByQ = new Map<number, { trips: number; km: number }>()
  for (const m of (mileageResult.data ?? []) as Array<{
    date: string
    km: number
    round_trip: boolean
  }>) {
    const month = getMonth(m.date)
    const q = QUARTERS.find((qq) => qq.months.includes(month))
    if (!q) continue
    const cur = mileageByQ.get(q.q) ?? { trips: 0, km: 0 }
    cur.trips++
    cur.km += m.round_trip ? m.km * 2 : m.km
    mileageByQ.set(q.q, cur)
  }

  const today = new Date()

  // Quarter readiness
  const quarterReadiness: QuarterReadiness[] = QUARTERS.map(({ q, label, months }) => {
    const qStartDate = new Date(year, months[0] - 1, 1)
    const qEndDate = new Date(year, months[months.length - 1], 0) // Last day of last month

    const hasStarted = today >= qStartDate
    const hasEnded = today > qEndDate

    const expRows = quarterMap.get(q) ?? []
    const uncategorizedCount = expRows.filter(
      (e) => !e.category || e.category === 'Uncategorized'
    ).length

    const sData = settlementsByQ.get(q) ?? { count: 0, revenue: 0 }
    const mData = mileageByQ.get(q) ?? { trips: 0, km: 0 }

    let status: QuarterStatus
    if (!hasStarted) {
      status = 'upcoming'
    } else if (!hasEnded) {
      status = 'in_progress'
    } else if (uncategorizedCount > 0) {
      status = 'needs_attention'
    } else {
      status = 'complete'
    }

    return {
      q,
      label,
      status,
      revenue: round2(sData.revenue),
      settlementCount: sData.count,
      expenseCount: expRows.length,
      uncategorizedCount,
      mileageTrips: mData.trips,
      mileageKm: round2(mData.km),
      hasStarted,
      hasEnded,
    }
  })

  // Quarter summaries (ITC)
  const quarters: QuarterSummary[] = QUARTERS.map(({ q, label, months }) => {
    const rows = quarterMap.get(q)!
    let itc = 0,
      pretax = 0,
      businessPortion = 0
    for (const e of rows) {
      itc += e.tax_amount
      pretax += e.pretax
      businessPortion += e.pretax * (e.business_use_pct / 100)
    }
    return {
      q,
      label,
      months,
      itc: round2(itc),
      pretax: round2(pretax),
      businessPortion: round2(businessPortion),
      count: rows.length,
    }
  })

  const ytd = {
    itc: round2(quarters.reduce((s, q) => s + q.itc, 0)),
    pretax: round2(quarters.reduce((s, q) => s + q.pretax, 0)),
    businessPortion: round2(quarters.reduce((s, q) => s + q.businessPortion, 0)),
    count: expenses.length,
  }

  // T2125 line totals
  const deductibleExpenses = expenses.filter((e) => !LOAN_CATEGORIES.has(e.category))
  const categoryToPretax = new Map<
    string,
    { pretax: number; businessPortion: number; count: number }
  >()
  for (const e of deductibleExpenses) {
    const cur = categoryToPretax.get(e.category) ?? { pretax: 0, businessPortion: 0, count: 0 }
    cur.pretax += e.pretax
    cur.businessPortion += e.pretax * (e.business_use_pct / 100)
    cur.count++
    categoryToPretax.set(e.category, cur)
  }

  const t2125: T2125Line[] = T2125_MAP.map(({ line, label, categories }) => {
    let pretax = 0,
      businessPortion = 0,
      count = 0
    for (const cat of categories) {
      const row = categoryToPretax.get(cat)
      if (row) {
        pretax += row.pretax
        businessPortion += row.businessPortion
        count += row.count
      }
    }
    return {
      line,
      label,
      categories,
      pretax: round2(pretax),
      businessPortion: round2(businessPortion),
      count,
    }
  }).filter((l) => l.count > 0)

  return NextResponse.json({
    year,
    quarters,
    ytd,
    t2125,
    loanRepaymentPretax: round2(loanRepaymentPretax),
    zeroGstExpenses: zeroGstCount,
    quarterReadiness,
  } satisfies TaxSummaryResponse)
}
