// GET /api/health/lease
//
// Dead-man's-switch endpoint. Reads LAST_HEARTBEAT_AT from harness_config
// and returns alive/stale status based on age.
//
// Public — no auth. Safe: only reads a single timestamp, no PII.
//
// 200 { status:"alive", last_heartbeat_at, age_seconds } if heartbeat <15m
// 503 { status:"stale", last_heartbeat_at, age_seconds } if heartbeat >=15m
//     (including if the key is missing — harness has never run)

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const STALE_THRESHOLD_SECONDS = 15 * 60 // 15 minutes

export async function GET() {
  const db = createServiceClient()
  const { data } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'LAST_HEARTBEAT_AT')
    .maybeSingle()

  if (!data?.value) {
    return NextResponse.json(
      { status: 'stale', last_heartbeat_at: null, age_seconds: null },
      { status: 503 }
    )
  }

  const lastBeat = new Date(data.value as string)
  const age_seconds = Math.floor((Date.now() - lastBeat.getTime()) / 1000)
  const alive = age_seconds < STALE_THRESHOLD_SECONDS

  return NextResponse.json(
    { status: alive ? 'alive' : 'stale', last_heartbeat_at: lastBeat.toISOString(), age_seconds },
    { status: alive ? 200 : 503 }
  )
}
