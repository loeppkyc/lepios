import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export interface MonthSummary {
  month: string       // 'YYYY-MM'
  label: string       // 'January 2026'
  closed: boolean
  closedAt: string | null
  closedNotes: string | null
  expenseCount: number
  expenseTotal: number
  itcTotal: number
  revenue: number
  settlementCount: number
}

export interface MonthlyCloseResponse {
  year: number
  months: MonthSummary[]
  closedCount: number
  openCount: number
}

function pad(n: number) { return String(n).padStart(2, '0') }

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`

  const [closesRes, expensesRes, settlementsRes] = await Promise.all([
    supabase.from('monthly_closes').select('month, closed_at, notes').gte('month', `${year}-01`).lte('month', `${year}-12`),
    supabase.from('business_expenses').select('date, pretax, tax_amount').gte('date', yearStart).lte('date', yearEnd),
    supabase.from('amazon_settlements').select('period_end_at, net_payout').gte('period_end_at', yearStart).lte('period_end_at', yearEnd),
  ])

  const closeMap = new Map<string, { closed_at: string; notes: string | null }>()
  for (const c of (closesRes.data ?? [])) {
    closeMap.set(c.month, { closed_at: c.closed_at, notes: c.notes })
  }

  // Group expenses by month
  const expByMonth = new Map<string, { count: number; total: number; itc: number }>()
  for (const e of (expensesRes.data ?? [])) {
    const m = e.date.slice(0, 7)
    const cur = expByMonth.get(m) ?? { count: 0, total: 0, itc: 0 }
    cur.count++
    cur.total += Number(e.pretax)
    cur.itc += Number(e.tax_amount)
    expByMonth.set(m, cur)
  }

  // Group settlements by month
  const settByMonth = new Map<string, { count: number; revenue: number }>()
  for (const s of (settlementsRes.data ?? [])) {
    const m = (s.period_end_at as string).slice(0, 7)
    const cur = settByMonth.get(m) ?? { count: 0, revenue: 0 }
    cur.count++
    cur.revenue += Number(s.net_payout)
    settByMonth.set(m, cur)
  }

  const months: MonthSummary[] = Array.from({ length: 12 }, (_, i) => {
    const monthNum = i + 1
    const key = `${year}-${pad(monthNum)}`
    const close = closeMap.get(key)
    const exp = expByMonth.get(key) ?? { count: 0, total: 0, itc: 0 }
    const sett = settByMonth.get(key) ?? { count: 0, revenue: 0 }
    return {
      month: key,
      label: `${MONTHS[i]} ${year}`,
      closed: !!close,
      closedAt: close?.closed_at ?? null,
      closedNotes: close?.notes ?? null,
      expenseCount: exp.count,
      expenseTotal: Math.round(exp.total * 100) / 100,
      itcTotal: Math.round(exp.itc * 100) / 100,
      revenue: Math.round(sett.revenue * 100) / 100,
      settlementCount: sett.count,
    }
  })

  return NextResponse.json({
    year,
    months,
    closedCount: months.filter(m => m.closed).length,
    openCount: months.filter(m => !m.closed && m.expenseCount > 0).length,
  } satisfies MonthlyCloseResponse)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { month: string; notes?: string }
  if (!body.month || !/^\d{4}-\d{2}$/.test(body.month)) {
    return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 })
  }

  const { error } = await supabase.from('monthly_closes').upsert({
    month: body.month,
    notes: body.notes ?? null,
    user_id: user.id,
    closed_at: new Date().toISOString(),
  }, { onConflict: 'month' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')
  if (!month) return NextResponse.json({ error: 'month required' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('monthly_closes').delete().eq('month', month)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
