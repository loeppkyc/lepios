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
    title,
    sku,
    listing_price,
    buy_it_now_price,
    quantity,
    status,
    ebay_item_id,
    listed_at,
    sold_at,
    sold_price,
    fees,
    notes,
  } = body as Record<string, unknown>

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof title === 'string') update.title = title.trim()
  if (sku !== undefined) update.sku = typeof sku === 'string' && sku ? sku.trim() : null
  if (listing_price !== undefined)
    update.listing_price = typeof listing_price === 'number' ? listing_price : null
  if (buy_it_now_price !== undefined)
    update.buy_it_now_price = typeof buy_it_now_price === 'number' ? buy_it_now_price : null
  if (typeof quantity === 'number') update.quantity = quantity
  if (typeof status === 'string') update.status = status
  if (ebay_item_id !== undefined)
    update.ebay_item_id =
      typeof ebay_item_id === 'string' && ebay_item_id ? ebay_item_id.trim() : null
  if (listed_at !== undefined)
    update.listed_at = typeof listed_at === 'string' && listed_at ? listed_at : null
  if (sold_at !== undefined)
    update.sold_at = typeof sold_at === 'string' && sold_at ? sold_at : null
  if (sold_price !== undefined)
    update.sold_price = typeof sold_price === 'number' ? sold_price : null
  if (fees !== undefined) update.fees = typeof fees === 'number' ? fees : null
  if (notes !== undefined) update.notes = typeof notes === 'string' && notes ? notes.trim() : null

  const { data, error } = await supabase
    .from('ebay_listings')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ listing: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { error } = await supabase.from('ebay_listings').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
