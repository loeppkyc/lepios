import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { RecurringTemplate } from '@/lib/types/expenses'

export const revalidate = 0

// GET /api/expenses/recurring — list all templates
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('recurring_expense_templates')
    .select('*')
    .order('active', { ascending: false })
    .order('vendor')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ templates: (data ?? []) as RecurringTemplate[] })
}

// POST /api/expenses/recurring — create template
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { vendor, category, pretax, taxAmount, paymentMethod, dayOfMonth, frequency, annualMonth, notes, businessUsePct } = body

  if (typeof vendor !== 'string' || !vendor.trim())
    return NextResponse.json({ error: 'vendor required' }, { status: 400 })
  if (typeof category !== 'string' || !category.trim())
    return NextResponse.json({ error: 'category required' }, { status: 400 })
  if (typeof pretax !== 'number' || pretax <= 0)
    return NextResponse.json({ error: 'pretax must be positive' }, { status: 400 })
  if (typeof taxAmount !== 'number' || taxAmount < 0)
    return NextResponse.json({ error: 'taxAmount must be >= 0' }, { status: 400 })
  if (typeof paymentMethod !== 'string' || !paymentMethod.trim())
    return NextResponse.json({ error: 'paymentMethod required' }, { status: 400 })

  const freq = (frequency ?? 'monthly') as string
  if (!['monthly', 'annual'].includes(freq))
    return NextResponse.json({ error: 'frequency must be monthly or annual' }, { status: 400 })

  const day = typeof dayOfMonth === 'number' ? Math.round(dayOfMonth) : 1
  if (day < 1 || day > 28)
    return NextResponse.json({ error: 'dayOfMonth must be 1–28' }, { status: 400 })

  if (freq === 'annual') {
    if (typeof annualMonth !== 'number' || annualMonth < 1 || annualMonth > 12)
      return NextResponse.json({ error: 'annualMonth (1–12) required for annual templates' }, { status: 400 })
  }

  const bup = typeof businessUsePct === 'number' ? Math.round(businessUsePct) : 100
  if (bup < 0 || bup > 100)
    return NextResponse.json({ error: 'businessUsePct must be 0–100' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('recurring_expense_templates')
    .insert({
      vendor: vendor.trim(),
      category: category.trim(),
      pretax,
      tax_amount: taxAmount,
      payment_method: (paymentMethod as string).trim(),
      day_of_month: day,
      frequency: freq,
      annual_month: freq === 'annual' ? annualMonth : null,
      notes: typeof notes === 'string' ? notes.trim() : '',
      business_use_pct: bup,
      active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ template: data as RecurringTemplate }, { status: 201 })
}
