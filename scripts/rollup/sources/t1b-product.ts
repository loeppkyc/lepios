import { createServiceClient } from '@/lib/supabase/service'
import type { TrackResult } from '../types'

export async function computeT1b(): Promise<TrackResult> {
  const t0 = Date.now()
  try {
    const db = createServiceClient()
    const { data, error } = await db.from('product_components').select('weight_pct, completion_pct')

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) throw new Error('product_components returned 0 rows')

    const rows = data as { weight_pct: number; completion_pct: number }[]
    const pts = rows.reduce(
      (sum, r) => sum + (Number(r.weight_pct) * Number(r.completion_pct)) / 100,
      0
    )
    const denom = rows.reduce((sum, r) => sum + Number(r.weight_pct), 0)

    return {
      track: 't1b',
      label: 'Product Components',
      strategic_weight_pct: 5,
      source: 'db',
      rollup_pct: denom > 0 ? Math.round((pts / denom) * 1000) / 10 : 0,
      raw_pts: Math.round(pts * 100) / 100,
      denominator: denom,
      known_undercount: false,
      source_stale: false,
      source_last_updated: null,
      compute_ms: Date.now() - t0,
      error: null,
    }
  } catch (err) {
    return {
      track: 't1b',
      label: 'Product Components',
      strategic_weight_pct: 5,
      source: 'db',
      rollup_pct: 0,
      raw_pts: 0,
      denominator: 0,
      known_undercount: false,
      source_stale: false,
      source_last_updated: null,
      compute_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
