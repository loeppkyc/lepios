import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ebay_listings')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ listings: data ?? [] })
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
    title,
    sku,
    listing_price,
    buy_it_now_price,
    quantity,
    status,
    ebay_item_id,
    listed_at,
    sold_price,
    fees,
    notes,
  } = body as Record<string, unknown>

  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('ebay_listings')
    .insert({
      user_id: user.id,
      title: title.trim(),
      sku: typeof sku === 'string' && sku ? sku.trim() : null,
      listing_price: typeof listing_price === 'number' ? listing_price : null,
      buy_it_now_price: typeof buy_it_now_price === 'number' ? buy_it_now_price : null,
      quantity: typeof quantity === 'number' ? quantity : 1,
      status: typeof status === 'string' ? status : 'draft',
      ebay_item_id: typeof ebay_item_id === 'string' && ebay_item_id ? ebay_item_id.trim() : null,
      listed_at: typeof listed_at === 'string' && listed_at ? listed_at : null,
      sold_price: typeof sold_price === 'number' ? sold_price : null,
      fees: typeof fees === 'number' ? fees : null,
      notes: typeof notes === 'string' && notes ? notes.trim() : null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ listing: data }, { status: 201 })
}
