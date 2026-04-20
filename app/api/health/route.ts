import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('agent_events').select('id').limit(1)
    if (error) {
      return NextResponse.json(
        { ok: false, db: 'unreachable', timestamp: new Date().toISOString() },
        { status: 503 }
      )
    }
    return NextResponse.json({ ok: true, db: 'reachable', timestamp: new Date().toISOString() })
  } catch {
    return NextResponse.json(
      { ok: false, db: 'unreachable', timestamp: new Date().toISOString() },
      { status: 503 }
    )
  }
}
