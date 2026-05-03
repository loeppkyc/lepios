import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ── PUT /api/expenses/[id] ────────────────────────────────────────────────────

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { date, vendor, category, pretax, taxAmount, paymentMethod, hubdoc, notes, businessUsePct } = body

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

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('business_expenses')
    .update({
      date,
      vendor: (vendor as string).trim(),
      category: (category as string).trim(),
      pretax,
      tax_amount: taxAmount,
      payment_method: (paymentMethod as string).trim(),
      hubdoc: hubdoc === true,
      notes: typeof notes === 'string' ? (notes as string).trim() : '',
      business_use_pct: Math.round(businessUsePct as number),
    })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// ── DELETE /api/expenses/[id] ─────────────────────────────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('business_expenses')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
