import { existsSync } from 'fs'
import { join } from 'path'
import { createServiceClient } from '@/lib/supabase/service'
import type { TrackResult } from '../types'

const ACCEPTANCE_DOC = join(process.cwd(), 'docs/acceptance/local-sales-webhook.md')

// T3 has 3 milestones: acceptance doc written → 25%, builder task assigned → 50%, PR merged → 100%.
// Doc check uses fs.existsSync (same pattern as T2). Task detection via task_queue description match.
export async function computeT3(): Promise<TrackResult> {
  const t0 = Date.now()
  try {
    const docExists = existsSync(ACCEPTANCE_DOC)
    const db = createServiceClient()
    const { data } = await db
      .from('task_queue')
      .select('status')
      .ilike('description', '%local-sales%')
      .limit(1)

    const taskRow = data?.[0] as { status: string } | undefined
    let rollup_pct = 0

    if (!taskRow) {
      // Spec written (doc exists) but not yet assigned to builder
      rollup_pct = docExists ? 25 : 0
    } else if (taskRow.status === 'completed') {
      rollup_pct = 100
    } else {
      rollup_pct = 50
    }

    return {
      track: 't3',
      label: 'Local Sales',
      strategic_weight_pct: 4.5,
      source: 'hardcoded',
      rollup_pct,
      raw_pts: rollup_pct,
      denominator: 100,
      known_undercount: false,
      source_stale: false,
      source_last_updated: null,
      compute_ms: Date.now() - t0,
      error: null,
    }
  } catch (err) {
    return {
      track: 't3',
      label: 'Local Sales',
      strategic_weight_pct: 4.5,
      source: 'hardcoded',
      rollup_pct: 0,
      raw_pts: 0,
      denominator: 100,
      known_undercount: false,
      source_stale: false,
      source_last_updated: null,
      compute_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
