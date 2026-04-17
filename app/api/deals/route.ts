import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const status = searchParams.get('status') ?? 'found'

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('deals')
    .select('id, asin, title, product_type, source, sell_price_cad, roi_pct, sales_rank, status, found_date, created_at')
    .eq('status', status)
    .order('found_date', { ascending: false })
    .order('roi_pct', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deals: data ?? [], count: data?.length ?? 0 })
}
