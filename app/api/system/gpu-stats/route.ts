import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface GpuMetrics {
  temp_c: number | null
  gpu_util_pct: number | null
  mem_util_pct: number | null
  mem_used_mb: number | null
  mem_total_mb: number | null
  clock_graphics_mhz: number | null
  clock_memory_mhz: number | null
  fan_speed_pct: number | null
  power_draw_w: number | null
  power_limit_w: number | null
}

export interface GpuHistoryPoint extends GpuMetrics {
  time: string
}

export interface GpuStatsResponse {
  latest: GpuMetrics | null
  latest_at: string | null
  history: GpuHistoryPoint[]
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('agent_events')
    .select('occurred_at, meta')
    .eq('domain', 'gpu')
    .eq('action', 'gpu.metrics')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(120)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []
  const history: GpuHistoryPoint[] = rows
    .map((r) => ({ time: r.occurred_at, ...(r.meta as GpuMetrics) }))
    .reverse()

  const latest = rows.length > 0 ? (rows[0].meta as GpuMetrics) : null
  const latest_at = rows.length > 0 ? rows[0].occurred_at : null

  return NextResponse.json({ latest, latest_at, history } satisfies GpuStatsResponse)
}
