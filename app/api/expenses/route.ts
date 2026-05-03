import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  expandRecurring,
  summariseExpenses,
  type Frequency,
  type BusinessExpense,
  type ExpensesResponse,
} from '@/lib/types/expenses'

export const revalidate = 0

// ── GET /api/expenses?month=YYYY-MM ──────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required (YYYY-MM)' }, { status: 400 })
  }

  const [year, mo] = month.split('-').map(Number)
  const lastDay = new Date(year, mo, 0).getDate()
  const from = `${month}-01`
  const to   = `${month}-${String(lastDay).padStart(2, '0')}`

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('business_expenses')
    .select('*')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const expenses = (data ?? []) as BusinessExpense[]
  const body: ExpensesResponse = {
    expenses,
    summary: summariseExpenses(expenses),
  }

  return NextResponse.json(body)
}

// ── POST /api/expenses ────────────────────────────────────────────────────────

interface CreateBody {
  date?: unknown
  vendor?: unknown
  category?: unknown
  pretax?: unknown
  taxAmount?: unknown
  paymentMethod?: unknown
  hubdoc?: unknown
  notes?: unknown
  businessUsePct?: unknown
  frequency?: unknown
}

export async function POST(request: Request) {
  let body: CreateBody
  try {
    body = (await request.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { date, vendor, category, pretax, taxAmount, paymentMethod, hubdoc, notes, businessUsePct, frequency } = body

  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 })
  }
  if (typeof vendor !== 'string' || !vendor.trim()) {
    return NextResponse.json({ error: 'vendor required' }, { status: 400 })
  }
  if (typeof category !== 'string' || !category.trim()) {
    return NextResponse.json({ error: 'category required' }, { status: 400 })
  }
  if (typeof pretax !== 'number' || pretax <= 0) {
    return NextResponse.json({ error: 'pretax must be a positive number' }, { status: 400 })
  }
  if (typeof taxAmount !== 'number' || taxAmount < 0) {
    return NextResponse.json({ error: 'taxAmount must be >= 0' }, { status: 400 })
  }
  if (typeof paymentMethod !== 'string' || !paymentMethod.trim()) {
    return NextResponse.json({ error: 'paymentMethod required' }, { status: 400 })
  }
  if (typeof businessUsePct !== 'number' || businessUsePct < 0 || businessUsePct > 100) {
    return NextResponse.json({ error: 'businessUsePct must be 0–100' }, { status: 400 })
  }
  const freq = (frequency ?? 'one-time') as Frequency
  if (!['one-time', 'monthly', 'annual'].includes(freq)) {
    return NextResponse.json({ error: 'frequency must be one-time | monthly | annual' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = expandRecurring(date, pretax, taxAmount as number, freq)

  const inserts = rows.map((r) => ({
    date: r.date,
    vendor: vendor.trim(),
    category: category.trim(),
    pretax: r.pretax,
    tax_amount: r.taxAmount,
    payment_method: (paymentMethod as string).trim(),
    hubdoc: hubdoc === true,
    notes: typeof notes === 'string' ? notes.trim() : '',
    business_use_pct: Math.round(businessUsePct as number),
  }))

  const { error } = await supabase.from('business_expenses').insert(inserts)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ created: inserts.length })
}
