import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ coupons: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    store,
    description,
    discount_type,
    discount_value,
    min_purchase,
    expiry_date,
    code,
    category,
  } = body as Record<string, unknown>

  if (!store || typeof store !== 'string' || !description || typeof description !== 'string') {
    return NextResponse.json({ error: 'store and description are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('coupons')
    .insert({
      user_id: user.id,
      store: store.trim(),
      description: description.trim(),
      discount_type: typeof discount_type === 'string' ? discount_type : 'pct',
      discount_value: typeof discount_value === 'number' ? discount_value : null,
      min_purchase: typeof min_purchase === 'number' ? min_purchase : null,
      expiry_date: typeof expiry_date === 'string' && expiry_date ? expiry_date : null,
      code: typeof code === 'string' && code ? code.trim() : null,
      category: typeof category === 'string' ? category : 'general',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ coupon: data }, { status: 201 })
}
