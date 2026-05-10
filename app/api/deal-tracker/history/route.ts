import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const itemId = searchParams.get('item_id')
  if (!itemId) return NextResponse.json({ error: 'item_id required' }, { status: 400 })

  // Verify ownership
  const { data: item } = await supabase
    .from('deal_tracker_items')
    .select('id')
    .eq('id', itemId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('deal_price_history')
    .select('*')
    .eq('item_id', itemId)
    .order('recorded_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ history: data ?? [] })
}
