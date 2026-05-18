import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSnapshotStats } from '@/lib/price-intel/snapshots'
import { computeDealScore } from '@/lib/price-intel/deal-score'

export const dynamic = 'force-dynamic'

// GET /api/price-intel/stats/[asin]?domain=6&currentPrice=29.99
// Returns SnapshotStats for an ASIN, plus optional DealScore if currentPrice is provided.
// Auth: requires authenticated Supabase session.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ asin: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { asin } = await params
  if (!asin) return NextResponse.json({ error: 'ASIN required' }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const domain = Number(searchParams.get('domain') ?? '6')
  const currentPriceParam = searchParams.get('currentPrice')
  const currentPrice = currentPriceParam != null ? Number(currentPriceParam) : null

  const stats = await getSnapshotStats(asin, domain)

  const response: {
    asin: string
    domain: number
    stats: typeof stats
    dealScore?: ReturnType<typeof computeDealScore>
  } = { asin, domain, stats }

  if (currentPrice != null && currentPrice > 0) {
    response.dealScore = computeDealScore(currentPrice, stats)
  }

  return NextResponse.json(response)
}
