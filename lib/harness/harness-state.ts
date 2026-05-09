import { createServiceClient } from '@/lib/supabase/service'

export type HarnessState = 'RUNNING' | 'IDLE' | 'STALLED' | 'HALTED'

interface HarnessStateInput {
  halted: boolean
  running: number
  queued: number
}

/** Pure state machine — no I/O. */
export function computeHarnessState({ halted, running, queued }: HarnessStateInput): HarnessState {
  if (halted) return 'HALTED'
  if (running > 0) return 'RUNNING'
  if (queued > 0) return 'STALLED'
  return 'IDLE'
}

/**
 * Read live task counts + HARNESS_HALTED from DB, compute state, persist
 * HARNESS_STATE + HARNESS_STATE_CHANGED_AT on transition.
 *
 * Has side effects (upserts harness_config rows on state change).
 * Use computeHarnessState() directly (with data you read yourself) when
 * side effects are not acceptable (e.g. /api/health/lease).
 */
export async function readHarnessState(): Promise<{
  state: HarnessState
  stateChangedAt: string | null
  halted: boolean
  running: number
  queued: number
}> {
  const db = createServiceClient()

  const [{ data: liveRows }, { data: haltRow }, { data: stateRow }, { data: changedRow }] =
    await Promise.all([
      db.from('task_queue').select('status').in('status', ['queued', 'claimed', 'running']),
      db.from('harness_config').select('value').eq('key', 'HARNESS_HALTED').maybeSingle(),
      db.from('harness_config').select('value').eq('key', 'HARNESS_STATE').maybeSingle(),
      db.from('harness_config').select('value').eq('key', 'HARNESS_STATE_CHANGED_AT').maybeSingle(),
    ])

  const rows = (liveRows ?? []) as { status: string }[]
  const halted = (haltRow as { value: string } | null)?.value === 'true'
  const running = rows.filter((r) => r.status === 'claimed' || r.status === 'running').length
  const queued = rows.filter((r) => r.status === 'queued').length

  const newState = computeHarnessState({ halted, running, queued })
  const prevState = (stateRow as { value: string } | null)?.value
  const existingChangedAt = (changedRow as { value: string } | null)?.value ?? null

  if (newState !== prevState) {
    const now = new Date().toISOString()
    await Promise.all([
      db
        .from('harness_config')
        .upsert({ key: 'HARNESS_STATE', value: newState }, { onConflict: 'key' }),
      db
        .from('harness_config')
        .upsert({ key: 'HARNESS_STATE_CHANGED_AT', value: now }, { onConflict: 'key' }),
    ])
    return { state: newState, stateChangedAt: now, halted, running, queued }
  }

  return { state: newState, stateChangedAt: existingChangedAt, halted, running, queued }
}
