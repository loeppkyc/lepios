import { NextResponse } from 'next/server'
import { getActiveSessions } from '@/lib/harness/window-tracker'
import { getComponentsWithHealth } from '@/lib/harness/component-health'
import { getIncidentLog, get90DayBars } from '@/lib/harness/status-data'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [sessions, components, incidents, bars] = await Promise.all([
      getActiveSessions(),
      getComponentsWithHealth(),
      getIncidentLog(),
      get90DayBars(),
    ])
    return NextResponse.json({
      active_sessions: sessions,
      count: sessions.length,
      components,
      incident_log: incidents,
      uptime_bars: bars,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
