import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface RegisterTransaction {
  id: string
  date: string
  vendor: string
  category: string
  pretax: number
  tax_amount: number
  total: number
  notes: string
  runningBalance: number
}

export interface BankRegisterResponse {
  account: string
  startDate: string
  endDate: string
  openingBalance: number
  openingDate: string
  transactions: RegisterTransaction[]
  closingBalance: number
  transactionCount: number
}

export interface AccountListResponse {
  accounts: { name: string; count: number; lastDate: string }[]
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const account = searchParams.get('account')
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // No account = return account list
  if (!account) {
    const { data, error } = await supabase
      .from('business_expenses')
      .select('payment_method, date')
      .not('payment_method', 'is', null)
      .not('payment_method', 'eq', '')
      .order('date', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const map = new Map<string, { count: number; lastDate: string }>()
    for (const row of (data ?? [])) {
      const pm = row.payment_method as string
      if (!pm) continue
      const cur = map.get(pm) ?? { count: 0, lastDate: '' }
      cur.count++
      if (!cur.lastDate || row.date > cur.lastDate) cur.lastDate = row.date
      map.set(pm, cur)
    }

    return NextResponse.json({
      accounts: Array.from(map.entries())
        .map(([name, v]) => ({ name, count: v.count, lastDate: v.lastDate }))
        .sort((a, b) => b.count - a.count),
    } satisfies AccountListResponse)
  }

  // Fetch transactions for account
  const startDate = start ?? `${new Date().getFullYear()}-01-01`
  const endDate = end ?? new Date().toISOString().slice(0, 10)

  const [txRes, obRes] = await Promise.all([
    supabase
      .from('business_expenses')
      .select('id, date, vendor, category, pretax, tax_amount, notes')
      .eq('payment_method', account)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date')
      .order('created_at'),
    supabase
      .from('account_opening_balances')
      .select('opening_balance, opening_date')
      .eq('account_name', account)
      .maybeSingle(),
  ])

  if (txRes.error) return NextResponse.json({ error: txRes.error.message }, { status: 500 })

  const openingBalance = Number(obRes.data?.opening_balance ?? 0)
  const openingDate = obRes.data?.opening_date ?? startDate

  let running = openingBalance
  const transactions: RegisterTransaction[] = (txRes.data ?? []).map(row => {
    const total = Number(row.pretax) + Number(row.tax_amount)
    running -= total // expenses reduce balance
    return {
      id: row.id,
      date: row.date,
      vendor: row.vendor ?? '',
      category: row.category ?? '',
      pretax: Number(row.pretax),
      tax_amount: Number(row.tax_amount),
      total,
      notes: row.notes ?? '',
      runningBalance: Math.round(running * 100) / 100,
    }
  })

  return NextResponse.json({
    account,
    startDate,
    endDate,
    openingBalance,
    openingDate,
    transactions,
    closingBalance: Math.round(running * 100) / 100,
    transactionCount: transactions.length,
  } satisfies BankRegisterResponse)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { account_name: string; opening_balance: number; opening_date: string }
  if (!body.account_name) return NextResponse.json({ error: 'account_name required' }, { status: 400 })

  const { error } = await supabase.from('account_opening_balances').upsert({
    account_name: body.account_name,
    opening_balance: body.opening_balance ?? 0,
    opening_date: body.opening_date ?? '2026-01-01',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'account_name' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
