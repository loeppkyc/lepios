import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { RecurringTemplate } from '@/lib/types/expenses'

// POST /api/expenses/recurring/generate
// Body: { month: 'YYYY-MM' }
// Idempotent: skips any template already generated for this month.
export async function POST(request: Request) {
  let body: { month?: unknown }
  try {
    body = (await request.json()) as { month?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { month } = body
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month))
    return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 })

  const [year, mo] = month.split('-').map(Number)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch active templates
  const { data: templates, error: tErr } = await supabase
    .from('recurring_expense_templates')
    .select('*')
    .eq('active', true)

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  const active = (templates ?? []) as RecurringTemplate[]

  // Determine which templates apply to this month
  const applicable = active.filter((t) => {
    if (t.frequency === 'monthly') return true
    if (t.frequency === 'annual') return t.annual_month === mo
    return false
  })

  if (applicable.length === 0)
    return NextResponse.json({ generated: 0, skipped: 0 })

  // Find which templates already have a row for this month (idempotency)
  const templateIds = applicable.map((t) => t.id)
  const lastDay = new Date(year, mo, 0).getDate()
  const from = `${month}-01`
  const to = `${month}-${String(lastDay).padStart(2, '0')}`

  const { data: existing, error: eErr } = await supabase
    .from('business_expenses')
    .select('recurring_template_id')
    .in('recurring_template_id', templateIds)
    .gte('date', from)
    .lte('date', to)

  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })

  const alreadyGenerated = new Set((existing ?? []).map((r) => r.recurring_template_id))

  const toInsert = applicable
    .filter((t) => !alreadyGenerated.has(t.id))
    .map((t) => {
      // Clamp day to month's actual last day
      const day = Math.min(t.day_of_month, lastDay)
      const date = `${month}-${String(day).padStart(2, '0')}`
      return {
        date,
        vendor: t.vendor,
        category: t.category,
        pretax: t.pretax,
        tax_amount: t.tax_amount,
        payment_method: t.payment_method,
        notes: t.notes,
        business_use_pct: t.business_use_pct,
        hubdoc: false,
        recurring_template_id: t.id,
      }
    })

  if (toInsert.length > 0) {
    const { error: iErr } = await supabase.from('business_expenses').insert(toInsert)
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })
  }

  return NextResponse.json({
    generated: toInsert.length,
    skipped: applicable.length - toInsert.length,
  })
}
