import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET() {
  const db = createServiceClient()
  const { data, error } = await db
    .from('marketplace_listings')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ listings: data })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { title, source, sku, asin, isbn, list_price, notes } = body

  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })

  const db = createServiceClient()
  const { data: user } = await db.auth.getUser()

  const { data, error } = await db
    .from('marketplace_listings')
    .insert({
      user_id: user?.user?.id,
      title: title.trim(),
      source: source ?? 'manual',
      sku: sku ?? null,
      asin: asin ?? null,
      isbn: isbn ?? null,
      list_price: list_price != null ? Number(list_price) : null,
      notes: notes ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ listing: data }, { status: 201 })
}
