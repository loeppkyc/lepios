import { createServiceClient } from '@/lib/supabase/service'
import type { TrackResult } from '../types'

// Tier-weighted completion: done_tier_sum / total_tier_sum (port_status = 'complete').
// feat/streamlit-modules-lock (0174) landed — port_status sync is live.
// count-based pct is included in raw_pts for reference.
export async function computeT4(): Promise<TrackResult> {
  const t0 = Date.now()
  try {
    const db = createServiceClient()
    const { data, error } = await db.from('streamlit_modules').select('port_status, suggested_tier')

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) throw new Error('streamlit_modules returned 0 rows')

    const rows = data as { port_status: string; suggested_tier: number }[]
    const totalTier = rows.reduce((s, r) => s + Number(r.suggested_tier), 0)
    const doneTier = rows
      .filter((r) => r.port_status === 'complete')
      .reduce((s, r) => s + Number(r.suggested_tier), 0)
    const totalCount = rows.length
    const doneCount = rows.filter((r) => r.port_status === 'complete').length

    const rollup_pct = totalTier > 0 ? Math.round((doneTier / totalTier) * 1000) / 10 : 0

    return {
      track: 't4',
      label: 'Streamlit Port Backlog',
      strategic_weight_pct: 13.5,
      source: 'db',
      rollup_pct,
      raw_pts: doneCount,
      denominator: totalCount,
      known_undercount: false,
      source_stale: false,
      source_last_updated: null,
      compute_ms: Date.now() - t0,
      error: null,
    }
  } catch (err) {
    return {
      track: 't4',
      label: 'Streamlit Port Backlog',
      strategic_weight_pct: 13.5,
      source: 'db',
      rollup_pct: 0,
      raw_pts: 0,
      denominator: 0,
      known_undercount: true,
      source_stale: false,
      source_last_updated: null,
      compute_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
