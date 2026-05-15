/**
 * POST /api/trading/learn
 *
 * Claude weight auto-tuning for the trading AI engine.
 * Only runs when >= 20 completed predictions exist.
 * Inserts a new prediction_weights row with is_active=true,
 * deactivates the prior active row.
 *
 * Auth: requireCronSecret (F22)
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { analyzeAndLearn } from '@/lib/trading/learn'
import type { PredictionWeights } from '@/lib/trading/types'
import { DEFAULT_WEIGHTS } from '@/lib/trading/types'

const MIN_SAMPLE_SIZE = 20

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const supabase = createServiceClient()

  // ── Check sample size ───────────────────────────────────────────────────────
  const { count, error: countErr } = await supabase
    .from('predictions')
    .select('id', { count: 'exact', head: true })
    .eq('domain', 'trading')
    .not('won', 'is', null)

  if (countErr) {
    return NextResponse.json({ error: 'Database error', detail: countErr.message }, { status: 500 })
  }

  const sampleSize = count ?? 0

  if (sampleSize < MIN_SAMPLE_SIZE) {
    return NextResponse.json({
      skipped: true,
      reason: `Need ${MIN_SAMPLE_SIZE} completed predictions, have ${sampleSize}`,
      sample_size: sampleSize,
    })
  }

  // ── Load completed predictions ──────────────────────────────────────────────
  const { data: completedRows, error: predsErr } = await supabase
    .from('predictions')
    .select(
      'ticker, direction, grade, weighted_score, won, actual_pnl, entry_price, stop_price, target_price, exit_price'
    )
    .eq('domain', 'trading')
    .not('won', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(50) // use last 50 for recency weighting

  if (predsErr || !completedRows) {
    return NextResponse.json(
      { error: 'Database error', detail: predsErr?.message },
      { status: 500 }
    )
  }

  // ── Load current weights ────────────────────────────────────────────────────
  const { data: weightsRow } = await supabase
    .from('prediction_weights')
    .select('id, weights')
    .eq('domain', 'trading')
    .eq('is_active', true)
    .single()

  const currentWeights: PredictionWeights = weightsRow?.weights ?? DEFAULT_WEIGHTS

  // ── Call Claude ─────────────────────────────────────────────────────────────
  const completedTrades = completedRows.map((r) => ({
    ticker: r.ticker ?? 'UNKNOWN',
    direction: (r.direction ?? 'long') as 'long' | 'short',
    grade: r.grade,
    weighted_score: r.weighted_score ?? 0,
    won: r.won,
    actual_pnl: r.actual_pnl,
    entry_price: r.entry_price,
    stop_price: r.stop_price,
    target_price: r.target_price,
    exit_price: r.exit_price,
  }))

  const { weights: newWeights, reasoning } = await analyzeAndLearn(completedTrades, currentWeights)

  const winRate = completedRows.filter((r) => r.won === true).length / completedRows.length

  // ── Deactivate current weights, insert new ──────────────────────────────────
  if (weightsRow?.id) {
    await supabase.from('prediction_weights').update({ is_active: false }).eq('id', weightsRow.id)
  }

  const { data: newRow, error: insertErr } = await supabase
    .from('prediction_weights')
    .insert({
      domain: 'trading',
      weights: newWeights,
      generated_by: 'analyze_and_learn',
      reasoning,
      sample_window: completedRows.length,
      win_rate_at_generation: parseFloat(winRate.toFixed(4)),
      is_active: true,
    })
    .select()
    .single()

  if (insertErr) {
    // Rollback: re-activate the old row
    if (weightsRow?.id) {
      await supabase.from('prediction_weights').update({ is_active: true }).eq('id', weightsRow.id)
    }
    return NextResponse.json(
      { error: 'Failed to insert new weights', detail: insertErr.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    updated: true,
    new_weights_id: newRow.id,
    sample_size: completedRows.length,
    win_rate: winRate,
    reasoning,
    weights: newWeights,
  })
}
