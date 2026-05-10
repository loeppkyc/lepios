import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DealTrackerItem } from '@/lib/deal-tracker/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('deal_tracker_items')
    .select('*')
    .eq('user_id', user.id)
    .order('added_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as Partial<DealTrackerItem>
  const { product, url, store, target_price, current_price } = body

  if (!product || target_price == null) {
    return NextResponse.json({ error: 'product and target_price required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('deal_tracker_items')
    .insert({ user_id: user.id, product, url: url ?? null, store: store ?? null, target_price, current_price: current_price ?? null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Seed price history if initial price provided
  if (current_price != null && data) {
    await supabase.from('deal_price_history').insert({ item_id: data.id, price: current_price })
  }

  return NextResponse.json({ item: data })
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { id: string; current_price: number }
  const { id, current_price } = body
  if (!id || current_price == null) {
    return NextResponse.json({ error: 'id and current_price required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('deal_tracker_items')
    .update({ current_price, last_checked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('deal_price_history').insert({ item_id: id, price: current_price })

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase
    .from('deal_tracker_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
