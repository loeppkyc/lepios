import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authError = requireCronSecret(request)
  if (authError) return authError

  const service = createServiceClient()

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: events, error } = await service
    .from('agent_events')
    .select('occurred_at, actor, meta, input_summary')
    .eq('action', 'scope_drift')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by day (MDT)
  const byDay: Record<string, number> = {}
  const windowsWithDrift = new Set<string>()

  for (const e of events ?? []) {
    const day = new Date(e.occurred_at).toLocaleDateString('en-CA', {
      timeZone: 'America/Edmonton',
    })
    byDay[day] = (byDay[day] ?? 0) + 1
    if (e.actor) windowsWithDrift.add(e.actor)
  }

  // Total distinct actors in the window (all actions) for drift-free count
  const { data: allActors } = await service
    .from('agent_events')
    .select('actor')
    .gte('occurred_at', since)
    .not('actor', 'is', null)
    .eq('domain', 'claude_code')

  const totalWindows = new Set((allActors ?? []).map((r) => r.actor).filter(Boolean)).size

  return NextResponse.json({
    dailyCounts: Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count })),
    totalWindows,
    driftWindows: windowsWithDrift.size,
    driftFreeWindows: Math.max(0, totalWindows - windowsWithDrift.size),
    recentEvents: (events ?? []).slice(0, 50),
  })
}
