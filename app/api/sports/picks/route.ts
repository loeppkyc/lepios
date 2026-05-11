import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logPicksForDay, getPicksForRange } from '@/lib/sports/picks'
import type { Game } from '@/lib/sports/odds'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })
  const from = searchParams.get('from') ?? today
  const to = searchParams.get('to') ?? today

  try {
    const picks = await getPicksForRange(from, to)
    return NextResponse.json({ picks })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { games: Game[] }
  if (!Array.isArray(body.games)) {
    return NextResponse.json({ error: 'games array required' }, { status: 400 })
  }

  try {
    const logged = await logPicksForDay(body.games)
    return NextResponse.json({ logged })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
