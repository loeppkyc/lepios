import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface BulkRow {
  date: string
  vendor: string
  category: string
  pretax: number
  tax_amount: number
  payment_method: string
  notes: string
  business_use_pct: number
}

export async function POST(request: Request) {
  let rows: unknown
  try {
    rows = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows array required (non-empty)' }, { status: 400 })
  }
  if (rows.length > 500) {
    return NextResponse.json({ error: 'max 500 rows per bulk import' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const inserts = (rows as BulkRow[]).map((r) => ({
    date: String(r.date ?? ''),
    vendor: String(r.vendor ?? '').trim(),
    category: String(r.category ?? '').trim(),
    pretax: Math.round((Number(r.pretax) || 0) * 100) / 100,
    tax_amount: Math.round((Number(r.tax_amount) || 0) * 100) / 100,
    payment_method: String(r.payment_method ?? '').trim(),
    hubdoc: false,
    notes: String(r.notes ?? '').trim(),
    business_use_pct: Math.min(100, Math.max(0, Math.round(Number(r.business_use_pct) || 100))),
  }))

  const { error } = await supabase.from('business_expenses').insert(inserts)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ created: inserts.length })
}
