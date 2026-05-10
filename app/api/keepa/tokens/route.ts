import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTokenStatus, estimateTokenCost } from '@/lib/keepa/tokens'
import { keepaConfigured } from '@/lib/keepa/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!keepaConfigured()) {
    return NextResponse.json({ error: 'KEEPA_API_KEY not configured' }, { status: 503 })
  }

  const status = await getTokenStatus()
  if (!status) {
    return NextResponse.json({ error: 'Failed to fetch token status' }, { status: 502 })
  }

  return NextResponse.json({
    ...status,
    estimates: {
      scan50WithHistory: estimateTokenCost(50, true),
      scan50StatsOnly: estimateTokenCost(50, false),
      scan100StatsOnly: estimateTokenCost(100, false),
    },
  })
}
