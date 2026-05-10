import { createServiceClient } from '@/lib/supabase/service'
import { computeT1 } from './sources/t1-harness'
import { computeT1b } from './sources/t1b-product'
import { computeT2 } from './sources/t2-amazon'
import { computeT3 } from './sources/t3-local-sales'
import { computeT4 } from './sources/t4-streamlit'
import { computeT5 } from './sources/t5-gpu-day'
import { computeT6 } from './sources/t6-parked-backlog'
import type { RollupReport, TrackResult } from './types'

async function fetchPrevStrategicPct(): Promise<number | null> {
  try {
    const db = createServiceClient()
    const { data } = await db
      .from('agent_events')
      .select('meta')
      .eq('action', 'rollup_computed')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const pct = (data as { meta?: { strategic_pct?: number } } | null)?.meta?.strategic_pct
    return typeof pct === 'number' ? pct : null
  } catch {
    return null
  }
}

async function logToAgentEvents(report: RollupReport): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'harness',
      action: 'rollup_computed',
      actor: 'auto_rollup',
      status: report.errors_per_track === 0 ? 'success' : 'warning',
      duration_ms: report.total_compute_ms,
      meta: {
        strategic_pct: report.strategic_pct,
        delta_vs_prev: report.delta_vs_prev,
        sources_polled: report.sources_polled,
        errors_per_track: report.errors_per_track,
        tracks: report.tracks.map((t) => ({
          track: t.track,
          rollup_pct: t.rollup_pct,
          error: t.error,
        })),
      },
    })
  } catch {
    // Non-fatal — digest still delivers even if logging fails
  }
}

export async function computeRollup(): Promise<RollupReport> {
  const start = Date.now()

  const [prevPct, t1, t1b, t2, t3, t4, t5, t6] = await Promise.all([
    fetchPrevStrategicPct(),
    computeT1(),
    computeT1b(),
    computeT2(),
    computeT3(),
    computeT4(),
    computeT5(),
    computeT6(),
  ])

  const tracks: TrackResult[] = [t1, t1b, t2, t3, t4, t5, t6]

  const strategic_pct =
    Math.round(
      tracks.reduce((sum, t) => {
        if (t.error) return sum
        return sum + (t.strategic_weight_pct * t.rollup_pct) / 100
      }, 0) * 10
    ) / 10

  const report: RollupReport = {
    computed_at: new Date().toISOString(),
    strategic_pct,
    delta_vs_prev: prevPct !== null ? Math.round((strategic_pct - prevPct) * 10) / 10 : null,
    tracks,
    sources_polled: tracks.length,
    errors_per_track: tracks.filter((t) => t.error !== null).length,
    total_compute_ms: Date.now() - start,
  }

  await logToAgentEvents(report)
  return report
}
