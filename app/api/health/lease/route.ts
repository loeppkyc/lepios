// GET /api/health/lease
//
// Dead-man's-switch endpoint. Reads LAST_HEARTBEAT_AT and live task counts,
// computes the 4-state harness model, returns appropriate HTTP status.
//
// Public — no auth. Safe: only reads timestamps and task counts, no PII.
//
// 200 { status:"alive", state:"RUNNING"|"IDLE", last_heartbeat_at, age_seconds }
// 503 { status:"stale",   state:"...", ... }  heartbeat ≥15 min
// 503 { status:"halted",  state:"HALTED", ... }  HARNESS_HALTED=true
// 503 { status:"stalled", state:"STALLED", ... } queued>0 AND running=0 AND not halted

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { computeHarnessState } from '@/lib/harness/harness-state'

export const dynamic = 'force-dynamic'

const STALE_THRESHOLD_SECONDS = 15 * 60 // 15 minutes

export async function GET() {
  const db = createServiceClient()

  const [{ data: beatRow }, { data: liveRows }, { data: haltRow }] = await Promise.all([
    db.from('harness_config').select('value').eq('key', 'LAST_HEARTBEAT_AT').maybeSingle(),
    db.from('task_queue').select('status').in('status', ['queued', 'claimed', 'running']),
    db.from('harness_config').select('value').eq('key', 'HARNESS_HALTED').maybeSingle(),
  ])

  // Heartbeat age check — stale beats everything
  if (!beatRow?.value) {
    return NextResponse.json(
      { status: 'stale', state: 'IDLE', last_heartbeat_at: null, age_seconds: null },
      { status: 503 }
    )
  }

  const lastBeat = new Date((beatRow as { value: string }).value)
  const age_seconds = Math.floor((Date.now() - lastBeat.getTime()) / 1000)

  if (age_seconds >= STALE_THRESHOLD_SECONDS) {
    return NextResponse.json(
      {
        status: 'stale',
        state: 'IDLE',
        last_heartbeat_at: lastBeat.toISOString(),
        age_seconds,
      },
      { status: 503 }
    )
  }

  // Compute current harness state from live data (no side effects)
  const rows = (liveRows ?? []) as { status: string }[]
  const halted = (haltRow as { value: string } | null)?.value === 'true'
  const running = rows.filter((r) => r.status === 'claimed' || r.status === 'running').length
  const queued = rows.filter((r) => r.status === 'queued').length
  const state = computeHarnessState({ halted, running, queued })

  const base = { last_heartbeat_at: lastBeat.toISOString(), age_seconds, state }

  if (state === 'HALTED') {
    return NextResponse.json({ status: 'halted', ...base }, { status: 503 })
  }

  if (state === 'STALLED') {
    return NextResponse.json({ status: 'stalled', ...base }, { status: 503 })
  }

  return NextResponse.json({ status: 'alive', ...base }, { status: 200 })
}
