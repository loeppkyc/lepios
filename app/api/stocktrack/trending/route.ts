import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTrending, STOCKTRACK_STORES } from '@/lib/retail/stocktrack-client'

export const dynamic = 'force-dynamic'

// GET /api/stocktrack/trending?store={code}
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const store = searchParams.get('store') ?? ''

  if (!store || !STOCKTRACK_STORES[store]) {
    return NextResponse.json(
      { error: `store required; valid: ${Object.keys(STOCKTRACK_STORES).join(', ')}` },
      { status: 400 }
    )
  }

  try {
    const trending = await getTrending(store)
    return NextResponse.json({ trending, store, store_name: STOCKTRACK_STORES[store] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'StockTrack unreachable'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
