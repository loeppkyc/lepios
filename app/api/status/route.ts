import { NextResponse } from 'next/server'
import { getActiveSessions } from '@/lib/harness/window-tracker'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const sessions = await getActiveSessions()
    return NextResponse.json({ active_sessions: sessions, count: sessions.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
