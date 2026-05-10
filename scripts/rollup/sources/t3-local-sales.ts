import { createServiceClient } from '@/lib/supabase/service'
import type { TrackResult } from '../types'

// T3 has 3 items (acceptance doc written, builder task assigned, PR merged).
// Acceptance doc exists → 25%. Builder task assigned → 50%. PR merged → 100%.
// Auto-detection: check task_queue for a row pointing to the local-sales acceptance doc.
export async function computeT3(): Promise<TrackResult> {
  const t0 = Date.now()
  try {
    const db = createServiceClient()
    const { data } = await db
      .from('task_queue')
      .select('status')
      .ilike('description', '%local-sales%')
      .limit(1)

    const taskRow = data?.[0] as { status: string } | undefined
    let rollup_pct = 0

    if (!taskRow) {
      // Acceptance doc exists but no task queued yet
      rollup_pct = 0
    } else if (taskRow.status === 'completed') {
      rollup_pct = 100
    } else {
      rollup_pct = 50
    }

    return {
      track: 't3',
      label: 'Local Sales',
      strategic_weight_pct: 5,
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
      strategic_weight_pct: 5,
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
