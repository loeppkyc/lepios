import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { EloRating } from '@/lib/sports/elo'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport') ?? 'nhl'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '32', 10), 100)

  const { data, error } = await supabase
    .from('elo_ratings')
    .select('*')
    .eq('sport', sport)
    .order('elo', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ratings: (data ?? []) as EloRating[],
    sport,
    count: data?.length ?? 0,
  })
}
