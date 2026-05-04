import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PATCH /api/expenses/recurring/[id] — update any field
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const update: Record<string, unknown> = {}
  if (typeof body.vendor === 'string') update.vendor = body.vendor.trim()
  if (typeof body.category === 'string') update.category = body.category.trim()
  if (typeof body.pretax === 'number') update.pretax = body.pretax
  if (typeof body.taxAmount === 'number') update.tax_amount = body.taxAmount
  if (typeof body.paymentMethod === 'string') update.payment_method = body.paymentMethod.trim()
  if (typeof body.dayOfMonth === 'number') update.day_of_month = Math.round(body.dayOfMonth)
  if (typeof body.frequency === 'string') update.frequency = body.frequency
  if (typeof body.annualMonth === 'number' || body.annualMonth === null)
    update.annual_month = body.annualMonth
  if (typeof body.notes === 'string') update.notes = body.notes.trim()
  if (typeof body.businessUsePct === 'number') update.business_use_pct = Math.round(body.businessUsePct)
  if (typeof body.active === 'boolean') update.active = body.active

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })

  const { data, error } = await supabase
    .from('recurring_expense_templates')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ template: data })
}

// DELETE /api/expenses/recurring/[id] — hard delete (expense rows keep history, FK → SET NULL)
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('recurring_expense_templates').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
