import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface TrustState {
  domain: string
  current_mode: string
  flipped_to_live_at: string | null
  flipped_to_live_by: string | null
  min_sample_size: number
  win_rate_threshold: number
  secondary_metric_key: string
  secondary_metric_threshold: number
  calibration_grade: string
  calibration_threshold: number
  max_drawdown_threshold: number
  current_sample_size: number
  current_win_rate: number | null
  current_secondary_metric: number | null
  current_calibration_rate: number | null
  current_drawdown: number | null
  last_recomputed_at: string | null
  gate_status: string
  gate_failures: unknown
  updated_at: string
}

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('trust_state')
    .select('*')
    .in('domain', ['sports', 'trading'])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as TrustState[]

  // Shape into a map for easy frontend consumption
  const byDomain: Record<
    string,
    {
      current_mode: string
      gate_status: string
      progress: {
        sample_size: number
        sample_size_target: number
        win_rate: number | null
        win_rate_target: number
        roi: number | null
        roi_target: number
        drawdown: number | null
        drawdown_target: number
      }
      thresholds: {
        min_sample_size: number
        win_rate_threshold: number
        secondary_metric_key: string
        secondary_metric_threshold: number
        max_drawdown_threshold: number
      }
      last_recomputed_at: string | null
      updated_at: string
    }
  > = {}

  for (const row of rows) {
    byDomain[row.domain] = {
      current_mode: row.current_mode,
      gate_status: row.gate_status,
      progress: {
        sample_size: row.current_sample_size,
        sample_size_target: row.min_sample_size,
        win_rate: row.current_win_rate,
        win_rate_target: row.win_rate_threshold,
        roi: row.current_secondary_metric,
        roi_target: row.secondary_metric_threshold,
        drawdown: row.current_drawdown,
        drawdown_target: row.max_drawdown_threshold,
      },
      thresholds: {
        min_sample_size: row.min_sample_size,
        win_rate_threshold: row.win_rate_threshold,
        secondary_metric_key: row.secondary_metric_key,
        secondary_metric_threshold: row.secondary_metric_threshold,
        max_drawdown_threshold: row.max_drawdown_threshold,
      },
      last_recomputed_at: row.last_recomputed_at,
      updated_at: row.updated_at,
    }
  }

  return NextResponse.json({ gates: byDomain })
}
