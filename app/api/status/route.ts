import { NextResponse } from 'next/server'
import { getActiveSessions } from '@/lib/harness/window-tracker'
import { getComponentsWithHealth } from '@/lib/harness/component-health'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [sessions, components] = await Promise.all([
      getActiveSessions(),
      getComponentsWithHealth(),
    ])
    return NextResponse.json({
      active_sessions: sessions,
      count: sessions.length,
      components,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
