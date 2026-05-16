import { createServiceClient } from '@/lib/supabase/service'

// ── Static heuristics table ────────────────────────────────────────────────────
// Maps (component:metric) → ceiling cause + lift cost label.
// Covers the three arb-engine signals seeded in migration 0216, plus the four
// process-efficiency signals written by buildProcessEfficiencyLines().
// Unknown pairs fall back to the generic message below — never silently dropped.

const CEILING_HEURISTICS: Record<string, { ceiling_cause: string; lift_cost_label: string }> = {
  'arb-engine:match_rate_pct': {
    ceiling_cause: 'Keepa token budget limits scan breadth; more tokens = more matches',
    lift_cost_label: 'Keepa tokens ~$5–20/mo to expand scan volume',
  },
  'arb-engine:buy_rate_pct': {
    ceiling_cause:
      'Buy decisions limited by price rule precision; lift requires tighter SP-API pricing',
    lift_cost_label: '~8h engineering (SP-API fee lookup per ASIN)',
  },
  'arb-engine:scan_latency_ms': {
    ceiling_cause: 'Sequential Keepa + SP-API calls; parallelization would cut latency',
    lift_cost_label: '~4h engineering (parallel fetch refactor)',
  },
  'process-efficiency:queue_throughput': {
    ceiling_cause: 'Routines API quota limits coordinator fires per day (cliff at ~12)',
    lift_cost_label: 'Anthropic Pro plan or quota increase request',
  },
  'process-efficiency:pickup_latency_ms': {
    ceiling_cause: 'Daily pickup cron fires once; more frequent cron = lower latency',
    lift_cost_label: 'Vercel Pro plan for sub-daily cron scheduling',
  },
  'process-efficiency:queue_depth': {
    ceiling_cause: 'Single coordinator per day; concurrency increase requires quota headroom',
    lift_cost_label: 'Quota increase (see queue_throughput ceiling)',
  },
  'process-efficiency:friction_index': {
    ceiling_cause: 'Grounding blocks trace to acceptance doc precision; spec quality improvement',
    lift_cost_label: '~2h coordinator work per sprint (Phase 1a study rigor)',
  },
}

const GENERIC_HEURISTIC = {
  ceiling_cause: 'No heuristic defined — add entry to CEILING_HEURISTICS',
  lift_cost_label: 'unknown',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImprovementRow {
  component: string
  metric: string
  unit: string
  value: number
  recorded_at: string
}

type TrendResult = 'flat' | 'declining' | 'improving' | 'insufficient_data'

// ── Trend detection ────────────────────────────────────────────────────────────
// Given the last N value rows for a (component, metric) pair (ascending by time),
// compute the trend across the most recent 3 deltas.
//
// Delta trend = "flat"     when std dev of last 3 deltas < 2.0 percentage points.
// Delta trend = "declining" when all 3 most recent deltas are negative.
// Otherwise = "improving" (any positive delta) or "insufficient_data" (< 5 rows).

function computeTrend(rows: ImprovementRow[]): TrendResult {
  // Need at least 5 rows to compute 4 deltas and check the most recent 3.
  if (rows.length < 5) return 'insufficient_data'

  // Sort ascending by recorded_at to ensure order
  const sorted = [...rows].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  )

  // Compute all consecutive deltas (value[i] - value[i-1])
  const deltas: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    deltas.push(sorted[i].value - sorted[i - 1].value)
  }

  // Take the last 3 deltas
  const last3 = deltas.slice(-3)
  if (last3.length < 3) return 'insufficient_data'

  // Check declining: all 3 negative
  if (last3.every((d) => d < 0)) return 'declining'

  // Check flat: std dev of the 3 deltas < 2.0
  const mean = last3.reduce((s, d) => s + d, 0) / 3
  const variance = last3.reduce((s, d) => s + Math.pow(d - mean, 2), 0) / 3
  const stdDev = Math.sqrt(variance)
  if (stdDev < 2.0) return 'flat'

  return 'improving'
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Builds the "Improvement ceilings" section for the morning digest.
 *
 * Reads the last 5 improvement_log rows per (component, metric) pair, computes
 * delta trend, and emits one line per pair that has reached a flat or declining
 * ceiling. When no ceilings are detected, returns the single "none detected" line.
 *
 * Never throws — returns the fallback string on any error.
 */
export async function buildCeilingMetricLines(): Promise<string> {
  try {
    const db = createServiceClient()

    // Fetch all rows, ordered so we can group and take last 5 per pair
    const { data, error } = await db
      .from('improvement_log')
      .select('component, metric, unit, value, recorded_at')
      .order('recorded_at', { ascending: true })
      .limit(1000)

    if (error || !data) {
      return 'Improvement ceilings: stats unavailable'
    }

    // Group by (component, metric)
    const grouped = new Map<string, ImprovementRow[]>()
    for (const row of data as ImprovementRow[]) {
      const key = `${row.component}:${row.metric}`
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(row)
    }

    const ceilingLines: string[] = []

    for (const [key, rows] of grouped.entries()) {
      // Take last 5 rows for the pair
      const last5 = rows.slice(-5)
      const trend = computeTrend(last5)

      if (trend !== 'flat' && trend !== 'declining') continue

      // Latest value + unit for display
      const latest = last5[last5.length - 1]
      const heuristic = CEILING_HEURISTICS[key] ?? GENERIC_HEURISTIC

      ceilingLines.push(
        `${latest.component}: ceiling at ${latest.metric}=${latest.value}${latest.unit} | cause: ${heuristic.ceiling_cause} | lift: ${heuristic.lift_cost_label}`
      )
    }

    if (ceilingLines.length === 0) {
      return 'Improvement ceilings: none detected'
    }

    return ['Improvement ceilings:', ...ceilingLines].join('\n')
  } catch {
    return 'Improvement ceilings: stats unavailable'
  }
}

// Export trend computation for unit testing
export { computeTrend }
export type { ImprovementRow, TrendResult }
