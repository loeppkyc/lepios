/**
 * POST /api/trading/score
 *
 * Scores all 14 instruments using technical analysis.
 * Upserts to predictions table (domain='trading') for today's date.
 * Called by the cron wrapper and can be called manually via curl.
 *
 * Auth: requireCronSecret (F22)
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { scoreInstrument } from '@/lib/trading/score'
import { ALL_INSTRUMENTS, DEFAULT_WEIGHTS } from '@/lib/trading/types'
import type { PredictionWeights, ScoreResult } from '@/lib/trading/types'
import type { OHLCVBar } from '@/lib/trading/score'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const supabase = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)

  // ── Load active weights ─────────────────────────────────────────────────────
  const { data: weightsRow, error: weightsErr } = await supabase
    .from('prediction_weights')
    .select('weights')
    .eq('domain', 'trading')
    .eq('is_active', true)
    .single()

  if (weightsErr) {
    console.error('[trading/score] weights fetch error:', weightsErr)
  }

  const weights: PredictionWeights = weightsRow?.weights ?? DEFAULT_WEIGHTS

  // ── Score each instrument ───────────────────────────────────────────────────
  const results: ScoreResult[] = []
  const errors: string[] = []

  for (const instrument of ALL_INSTRUMENTS) {
    try {
      // Fetch 60 days of daily OHLCV
      const endDate = new Date()
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - 70) // 70 days to ensure 60 trading days

      const history = await yahooFinance.historical(instrument.ticker, {
        period1: startDate.toISOString().slice(0, 10),
        period2: endDate.toISOString().slice(0, 10),
        interval: '1d',
      })

      if (!history || history.length < 10) {
        errors.push(`${instrument.ticker}: insufficient history (${history?.length ?? 0} bars)`)
        continue
      }

      const bars: OHLCVBar[] = history
        .filter((h) => h.open != null && h.high != null && h.low != null && h.close != null)
        .map((h) => ({
          date: h.date.toISOString().slice(0, 10),
          open: h.open,
          high: h.high,
          low: h.low,
          close: h.adjClose ?? h.close,
          volume: h.volume ?? 0,
        }))

      const scored = scoreInstrument(instrument, bars, weights)
      results.push(scored)
    } catch (err) {
      console.error(`[trading/score] ${instrument.ticker} failed:`, err)
      errors.push(`${instrument.ticker}: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  // ── Upsert to predictions ───────────────────────────────────────────────────
  const upserted: string[] = []

  for (const r of results) {
    const reasonText = r.reasons.join(' | ')

    // Use ON CONFLICT: if a prediction for this ticker+date already exists, update it
    const { error: upsertErr } = await supabase.from('predictions').upsert(
      {
        domain: 'trading',
        pick_date: today,
        grade: r.grade,
        confidence: r.confidence,
        reason: reasonText,
        mode: 'paper',
        ticker: r.ticker,
        direction: r.direction,
        entry_price: r.entry_price,
        stop_price: r.stop_price,
        target_price: r.target_price,
        atr: r.atr,
        risk_reward: r.risk_reward,
        raw_score: r.score,
        weighted_score: r.weighted_score,
        weights_snapshot: weights,
        person_handle: 'colin', // SPRINT5-GATE
      },
      {
        onConflict: 'ticker,pick_date,domain',
        ignoreDuplicates: false,
      }
    )

    if (upsertErr) {
      // onConflict upsert may fail if unique index doesn't exist — fall back to insert
      const { error: insertErr } = await supabase.from('predictions').insert({
        domain: 'trading',
        pick_date: today,
        grade: r.grade,
        confidence: r.confidence,
        reason: reasonText,
        mode: 'paper',
        ticker: r.ticker,
        direction: r.direction,
        entry_price: r.entry_price,
        stop_price: r.stop_price,
        target_price: r.target_price,
        atr: r.atr,
        risk_reward: r.risk_reward,
        raw_score: r.score,
        weighted_score: r.weighted_score,
        weights_snapshot: weights,
        person_handle: 'colin', // SPRINT5-GATE
      })
      if (insertErr) {
        console.error(`[trading/score] upsert/insert failed for ${r.ticker}:`, insertErr)
        errors.push(`${r.ticker}: db insert failed`)
        continue
      }
    }

    upserted.push(r.ticker)
  }

  // Sort results by weighted_score descending
  results.sort((a, b) => b.weighted_score - a.weighted_score)

  return NextResponse.json({
    scored: results.length,
    upserted: upserted.length,
    errors,
    results,
    today,
  })
}
