import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface RestockEvent {
  status_from: string | null
  status_to: string
  occurred_at: string
  source: string
}

export async function GET(
  _request: Request,
  { params }: { params: { set_number: string } }
): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { set_number } = params

  const { data: rows, error } = await supabase
    .from('lego_restock_events')
    .select('status_from, status_to, occurred_at, source')
    .eq('set_number', set_number)
    .order('occurred_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const events: RestockEvent[] = rows ?? []

  // All rows where the set came back in stock
  const restockEvents = events
    .filter((e) => e.status_to === 'E_AVAILABLE')
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())

  // Compute gaps (days) between consecutive restock events
  const gapDays: number[] = []
  for (let i = 1; i < restockEvents.length; i++) {
    const prev = new Date(restockEvents[i - 1].occurred_at).getTime()
    const curr = new Date(restockEvents[i].occurred_at).getTime()
    gapDays.push((curr - prev) / (1000 * 60 * 60 * 24))
  }

  const avgGapDays =
    gapDays.length > 0 ? gapDays.reduce((sum, d) => sum + d, 0) / gapDays.length : null

  const lastRestockAt =
    restockEvents.length > 0 ? restockEvents[restockEvents.length - 1].occurred_at : null

  let predictedNextWindow: string | null = null
  if (avgGapDays !== null && lastRestockAt !== null) {
    const predicted = new Date(new Date(lastRestockAt).getTime() + avgGapDays * 24 * 60 * 60 * 1000)
    predictedNextWindow = predicted.toISOString()
  }

  // Days since the most recent event of any type (out for X days signal)
  const mostRecentEvent = events.length > 0 ? events[0] : null
  const currentStreakDays = mostRecentEvent
    ? (Date.now() - new Date(mostRecentEvent.occurred_at).getTime()) / (1000 * 60 * 60 * 24)
    : null

  return NextResponse.json({
    set_number,
    total_events: events.length,
    restock_count: restockEvents.length,
    avg_gap_days: avgGapDays !== null ? Math.round(avgGapDays * 10) / 10 : null,
    last_restock_at: lastRestockAt,
    predicted_next_window: predictedNextWindow,
    current_streak_days:
      currentStreakDays !== null ? Math.round(currentStreakDays * 10) / 10 : null,
    events: events.map((e) => ({
      status_from: e.status_from,
      status_to: e.status_to,
      occurred_at: e.occurred_at,
      source: e.source,
    })),
  })
}
