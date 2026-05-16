import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface WindowSession {
  session_id: string
  started_at: string
  last_heartbeat: string
  current_task: string | null
  status: 'active' | 'ended'
  metadata: Record<string, unknown>
}

export interface DriftPoint {
  date: string
  drift_events: number
  sessions_started: number
}

export interface WindowActivityResponse {
  active_sessions: WindowSession[]
  recent_sessions: WindowSession[]
  drift_by_day: DriftPoint[]
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const [{ data: activeSessions }, { data: recentSessions }, { data: driftEvents }] =
    await Promise.all([
      supabase
        .from('window_sessions')
        .select('*')
        .eq('status', 'active')
        .gte('last_heartbeat', staleThreshold)
        .order('started_at', { ascending: false }),
      supabase
        .from('window_sessions')
        .select('*')
        .gte('started_at', since7d)
        .order('started_at', { ascending: false })
        .limit(50),
      supabase
        .from('agent_events')
        .select('occurred_at')
        .eq('action', 'branch_guard_triggered')
        .gte('occurred_at', since7d),
    ])

  // Build day buckets for last 7 days (Edmonton timezone)
  const TZ = 'America/Edmonton'
  const dayMap = new Map<string, { drift: number; sessions: number }>()
  for (let i = 6; i >= 0; i--) {
    const key = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', {
      timeZone: TZ,
    })
    dayMap.set(key, { drift: 0, sessions: 0 })
  }

  for (const ev of driftEvents ?? []) {
    const key = new Date(ev.occurred_at).toLocaleDateString('en-CA', { timeZone: TZ })
    const entry = dayMap.get(key)
    if (entry) entry.drift++
  }
  for (const sess of recentSessions ?? []) {
    const key = new Date(sess.started_at).toLocaleDateString('en-CA', { timeZone: TZ })
    const entry = dayMap.get(key)
    if (entry) entry.sessions++
  }

  const drift_by_day: DriftPoint[] = Array.from(dayMap.entries()).map(([date, v]) => ({
    date,
    drift_events: v.drift,
    sessions_started: v.sessions,
  }))

  return NextResponse.json({
    active_sessions: activeSessions ?? [],
    recent_sessions: (recentSessions ?? []).slice(0, 20),
    drift_by_day,
  } satisfies WindowActivityResponse)
}
