/**
 * Work-Budget Calibrator
 *
 * Reads last 50 estimation.complete agent_events, computes per-keyword
 * average error, and adjusts work_budget_keyword_weights with a ±20% bound.
 *
 * Called:
 *   - After every 10 task completions (from pickup-runner.ts)
 *   - Weekly via /api/cron/budget-calibrate
 */

import { createServiceClient } from '@/lib/supabase/service'
import { logEvent as logKnowledgeEvent } from '@/lib/knowledge/client'

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_SAMPLES_PER_KEYWORD = 3
const ERROR_THRESHOLD_PCT = 15 // % — below this, no adjustment
const WEIGHT_STEP_MINUTES = 5
const MAX_ADJUSTMENT_FACTOR = 0.2 // ±20% of current weight per cycle

// ── Types ─────────────────────────────────────────────────────────────────────

interface EstimationCompleteEvent {
  meta: {
    estimated_minutes: number
    actual_minutes: number
    estimation_error_pct: number
    bucket: string
    keywords_hit: string[]
    method: string
  }
}

// ── Main calibration function ─────────────────────────────────────────────────

export async function runCalibration(): Promise<{
  keywords_adjusted: string[]
  samples_used: number
}> {
  const db = createServiceClient()

  // Step 1: fetch last 50 estimation.complete events
  const { data: events, error: fetchError } = await db
    .from('agent_events')
    .select('meta')
    .eq('action', 'estimation.complete')
    .eq('domain', 'work_budget')
    .order('occurred_at', { ascending: false })
    .limit(50)

  if (fetchError || !events || events.length === 0) {
    return { keywords_adjusted: [], samples_used: 0 }
  }

  const typedEvents = events as { meta: Record<string, unknown> }[]

  // Step 2: group error_pct by keyword
  const keywordErrors: Record<string, number[]> = {}

  for (const event of typedEvents) {
    const meta = event.meta as EstimationCompleteEvent['meta'] | null
    if (!meta) continue

    const keywordsHit = Array.isArray(meta.keywords_hit) ? (meta.keywords_hit as string[]) : []
    const errorPct =
      typeof meta.estimation_error_pct === 'number' ? meta.estimation_error_pct : null

    if (errorPct === null) continue

    for (const kw of keywordsHit) {
      if (!keywordErrors[kw]) keywordErrors[kw] = []
      keywordErrors[kw].push(errorPct)
    }
  }

  // Step 3: load current weights
  const { data: weightRows, error: weightError } = await db
    .from('work_budget_keyword_weights')
    .select('keyword, weight_minutes')

  if (weightError || !weightRows) {
    return { keywords_adjusted: [], samples_used: events.length }
  }

  const currentWeights: Record<string, number> = {}
  for (const row of weightRows as { keyword: string; weight_minutes: number }[]) {
    currentWeights[row.keyword] = row.weight_minutes
  }

  const weightsBefore = { ...currentWeights }
  const weightsAfter = { ...currentWeights }
  const keywordsAdjusted: string[] = []

  // Step 4: compute adjustments
  for (const [keyword, errors] of Object.entries(keywordErrors)) {
    if (errors.length < MIN_SAMPLES_PER_KEYWORD) continue
    if (!(keyword in currentWeights)) continue

    const avgError = errors.reduce((a, b) => a + b, 0) / errors.length

    if (Math.abs(avgError) < ERROR_THRESHOLD_PCT) continue

    const currentWeight = currentWeights[keyword]
    const maxAdjustment = Math.abs(currentWeight) * MAX_ADJUSTMENT_FACTOR

    let delta = 0
    if (avgError > ERROR_THRESHOLD_PCT) {
      // Consistently undershooting: raise weight
      delta = Math.min(WEIGHT_STEP_MINUTES, maxAdjustment)
    } else if (avgError < -ERROR_THRESHOLD_PCT) {
      // Consistently overshooting: lower weight
      delta = -Math.min(WEIGHT_STEP_MINUTES, maxAdjustment)
    }

    if (delta === 0) continue

    weightsAfter[keyword] = currentWeight + delta
    keywordsAdjusted.push(keyword)
  }

  // Step 5: write updated weights
  if (keywordsAdjusted.length > 0) {
    const upserts = keywordsAdjusted.map((kw) => ({
      keyword: kw,
      weight_minutes: weightsAfter[kw],
      last_updated: new Date().toISOString(),
    }))

    await db
      .from('work_budget_keyword_weights')
      .upsert(upserts, { onConflict: 'keyword' })
      .throwOnError()
  }

  // Step 6: log calibration run
  void logKnowledgeEvent('work_budget', 'estimation.calibration_run', {
    actor: 'system',
    status: 'success',
    meta: {
      keywords_adjusted: keywordsAdjusted,
      weights_before: weightsBefore,
      weights_after: weightsAfter,
      samples_used: events.length,
    },
  })

  return { keywords_adjusted: keywordsAdjusted, samples_used: events.length }
}
