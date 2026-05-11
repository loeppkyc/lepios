import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  generateDebrief,
  generateDailyPicksAnalysis,
  generateStrategyReview,
} from '@/lib/sports/coach'
import { logEvent } from '@/lib/knowledge/client'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as Record<string, unknown>
  const action = body.action as string

  try {
    if (action === 'debrief') {
      const result = await generateDebrief(
        body.bet as Parameters<typeof generateDebrief>[0],
        body.result as 'Win' | 'Loss' | 'Push',
        (body.team_history as string) ?? ''
      )
      void logEvent('sports-intel', 'coach.debrief', { actor: 'user', status: 'success' })
      return NextResponse.json(result)
    }

    if (action === 'analysis') {
      const text = await generateDailyPicksAnalysis(
        body.picks as Parameters<typeof generateDailyPicksAnalysis>[0],
        (body.context as string) ?? ''
      )
      void logEvent('sports-intel', 'coach.analysis', { actor: 'user', status: 'success' })
      return NextResponse.json({ text })
    }

    if (action === 'strategy') {
      const text = await generateStrategyReview(
        body.stats as Parameters<typeof generateStrategyReview>[0]
      )
      void logEvent('sports-intel', 'coach.strategy', { actor: 'user', status: 'success' })
      return NextResponse.json({ text })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
