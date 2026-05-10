import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTodaysGames, filterFavorites, checkApiConnection } from '@/lib/sports/odds'

export const dynamic = 'force-dynamic'

const ODDS_API_KEY = process.env.ODDS_API_KEY ?? ''

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  if (action === 'status') {
    const status = await checkApiConnection(ODDS_API_KEY)
    return NextResponse.json(status)
  }

  const games = await getTodaysGames(ODDS_API_KEY)
  const maxOdds = parseInt(searchParams.get('maxOdds') ?? '-150', 10)
  const filterTo =
    searchParams.get('filter') === 'favorites' ? filterFavorites(games, maxOdds) : games

  return NextResponse.json({
    games: filterTo,
    total: games.length,
    favorites: filterFavorites(games, maxOdds).length,
    is_demo: !ODDS_API_KEY,
  })
}
