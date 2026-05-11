import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET() {
  const db = createServiceClient()
  const { data, error } = await db
    .from('repricer_rules')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { asin, title, rule_type, min_price, max_price, target_margin, notes } = body

  if (!asin || min_price == null || max_price == null) {
    return NextResponse.json({ error: 'asin, min_price, max_price required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data: user } = await db.auth.getUser()

  const { data, error } = await db
    .from('repricer_rules')
    .insert({
      user_id: user?.user?.id,
      asin: asin.trim().toUpperCase(),
      title: title ?? null,
      rule_type: rule_type ?? 'margin',
      min_price: Number(min_price),
      max_price: Number(max_price),
      target_margin: target_margin != null ? Number(target_margin) : null,
      notes: notes ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rule: data }, { status: 201 })
}
