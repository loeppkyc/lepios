import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CURRENT_CAPACITY_TIER,
  WEIGHTS_V1,
  BASELINE_MIN_RUNS,
  SCORER_VERSION,
} from './config'
import type {
  TickResult,
  DigestResult,
  QualityScore,
  QualityDimensions,
  HistoricalContext,
  CapacityTier,
} from './types'

// ── Dimension scorers ─────────────────────────────────────────────────────────

function scoreCompleteness(tick: TickResult): number {
  const n = tick.checks.length
  if (n === 0) return 0
  const total = tick.checks.reduce((sum, check) => {
    if (check.status === 'pass') return sum + 100 / n
    if (check.status === 'warn') return sum + 80 / n
    return sum // fail contributes 0
  }, 0)
  return Math.min(100, Math.max(0, total))
}

function scoreSignalQuality(tick: TickResult): number {
  const totalFlags = tick.checks.reduce((sum, c) => sum + c.flags.length, 0)
  return totalFlags === 0 ? 50 : 70
}

function percentileValue(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const index = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(index)
  const hi = Math.ceil(index)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (index - lo) * (sorted[hi] - sorted[lo])
}

function lerp(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (x1 === x0) return y0
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
}

function scoreEfficiencyMs(durationMs: number, history: HistoricalContext): number {
  if (history.prior_durations_ms.length < BASELINE_MIN_RUNS) return 50

  const sorted = [...history.prior_durations_ms].sort((a, b) => a - b)
  const p20 = percentileValue(sorted, 20)
  const p50 = percentileValue(sorted, 50)
  const p80 = percentileValue(sorted, 80)
  const twoXMedian = 2 * p50
  const fiveXMedian = 5 * p50

  const v = durationMs
  let score: number

  if (v <= p20) {
    score = 100
  } else if (v <= p50) {
    score = lerp(p20, 100, p50, 75, v)
  } else if (v <= p80) {
    score = lerp(p50, 75, p80, 50, v)
  } else if (v <= twoXMedian) {
    score = lerp(p80, 50, twoXMedian, 25, v)
  } else if (v <= fiveXMedian) {
    score = lerp(twoXMedian, 25, fiveXMedian, 0, v)
  } else {
    score = 0
  }

  return Math.min(100, Math.max(0, score))
}

function scoreEfficiency(tick: TickResult, history: HistoricalContext): number {
  return scoreEfficiencyMs(tick.duration_ms, history)
}

function scoreHygiene(tick: TickResult): number {
  const required: (keyof TickResult)[] = [
    'tick_id',
    'run_id',
    'mode',
    'started_at',
    'finished_at',
    'checks',
  ]
  let score = 100
  for (const field of required) {
    const v = tick[field]
    if (v === undefined || v === null || v === '') score -= 20
  }
  return Math.max(0, score)
}

// ── Main scorer ───────────────────────────────────────────────────────────────

export function scoreNightTick(tick: TickResult, history: HistoricalContext): QualityScore {
  const dimensions: QualityDimensions = {
    completeness: scoreCompleteness(tick),
    signal_quality: scoreSignalQuality(tick),
    efficiency: scoreEfficiency(tick, history),
    hygiene: scoreHygiene(tick),
  }

  const raw =
    dimensions.completeness * WEIGHTS_V1.completeness +
    dimensions.signal_quality * WEIGHTS_V1.signal_quality +
    dimensions.efficiency * WEIGHTS_V1.efficiency +
    dimensions.hygiene * WEIGHTS_V1.hygiene

  const aggregate = Math.round(raw * 10) / 10

  return {
    aggregate,
    capacity_tier: CURRENT_CAPACITY_TIER,
    dimensions,
    weights_version: 'v1',
    scored_at: new Date().toISOString(),
    scored_by: SCORER_VERSION,
  }
}

// ── Historical context fetcher ────────────────────────────────────────────────

export async function fetchHistoricalContext(
  supabase: SupabaseClient,
  task_type: string,
  capacity_tier: CapacityTier = CURRENT_CAPACITY_TIER
): Promise<HistoricalContext> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('agent_events')
    .select('duration_ms')
    .eq('task_type', task_type)
    .filter('quality_score->>capacity_tier', 'eq', capacity_tier)
    .gte('occurred_at', since)
    .not('duration_ms', 'is', null)
    .order('occurred_at', { ascending: false })
    .limit(100)

  const prior_durations_ms = (data ?? [])
    .map((row: { duration_ms: number | null }) => row.duration_ms)
    .filter((d): d is number => d !== null)

  return { task_type, capacity_tier, prior_durations_ms }
}

// ── Morning digest scorer ─────────────────────────────────────────────────────

function scoreDigestCompleteness(result: DigestResult): number {
  if (result.status === 'sent') return 100
  if (result.status === 'no_tick_found') return 50
  return 0 // 'telegram_failed'
}

function scoreDigestSignalQuality(result: DigestResult): number {
  return result.source_flag_count === 0 ? 50 : 70
}

function scoreDigestEfficiency(result: DigestResult, history: HistoricalContext): number {
  if (result.telegram_latency_ms === null) return 50
  return scoreEfficiencyMs(result.telegram_latency_ms, history)
}

function scoreDigestHygiene(result: DigestResult): number {
  const required: (keyof DigestResult)[] = ['status', 'composed_at']
  let score = 100
  for (const field of required) {
    const v = result[field]
    if (v === undefined || v === null || v === '') score -= 20
  }
  return Math.max(0, score)
}

export function scoreMorningDigest(result: DigestResult, history: HistoricalContext): QualityScore {
  const dimensions: QualityDimensions = {
    completeness: scoreDigestCompleteness(result),
    signal_quality: scoreDigestSignalQuality(result),
    efficiency: scoreDigestEfficiency(result, history),
    hygiene: scoreDigestHygiene(result),
  }

  const raw =
    dimensions.completeness * WEIGHTS_V1.completeness +
    dimensions.signal_quality * WEIGHTS_V1.signal_quality +
    dimensions.efficiency * WEIGHTS_V1.efficiency +
    dimensions.hygiene * WEIGHTS_V1.hygiene

  const aggregate = Math.round(raw * 10) / 10

  return {
    aggregate,
    capacity_tier: CURRENT_CAPACITY_TIER,
    dimensions,
    weights_version: 'v1',
    scored_at: new Date().toISOString(),
    scored_by: SCORER_VERSION,
  }
}
