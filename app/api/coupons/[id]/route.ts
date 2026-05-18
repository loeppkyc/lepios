import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  const {
    store,
    description,
    discount_type,
    discount_value,
    min_purchase,
    expiry_date,
    code,
    category,
    is_used,
  } = body as Record<string, unknown>

  const update: Record<string, unknown> = {}
  if (typeof store === 'string') update.store = store.trim()
  if (typeof description === 'string') update.description = description.trim()
  if (typeof discount_type === 'string') update.discount_type = discount_type
  if (discount_value !== undefined)
    update.discount_value = typeof discount_value === 'number' ? discount_value : null
  if (min_purchase !== undefined)
    update.min_purchase = typeof min_purchase === 'number' ? min_purchase : null
  if (expiry_date !== undefined)
    update.expiry_date = typeof expiry_date === 'string' && expiry_date ? expiry_date : null
  if (code !== undefined) update.code = typeof code === 'string' && code ? code.trim() : null
  if (typeof category === 'string') update.category = category
  if (typeof is_used === 'boolean') update.is_used = is_used

  const { data, error } = await supabase
    .from('coupons')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ coupon: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { error } = await supabase.from('coupons').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
