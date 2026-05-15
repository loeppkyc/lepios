/**
 * Technical scoring engine for the AI Pick Engine.
 *
 * Ported from Streamlit tools/trading_predictions.py `_score_instrument`.
 * 20% better: grades surfaced inline, reasons generated in-engine (not just numbers),
 * ATR-based stop/target replaces fixed pip values, weights from DB instead of hardcoded.
 *
 * Business logic only — no UI, no HTTP, no Supabase.
 *
 * Scoring components:
 *   trend:    price vs MA20 vs MA50 alignment (0–3)
 *   rsi:      14-period RSI confirmation (0–2)
 *   volume:   current vs 20-day avg volume (0–2)
 *   momentum: 5-day price change % (0–2)
 *   level:    proximity to pivot S1/R1 (0–2)
 *   streak:   3+ consecutive days in direction (0–1)
 * Max raw score: 12 (+ 1 streak bonus = 13 total)
 *
 * Grade thresholds (vs weighted_score):
 *   A  >= 9.0
 *   B+ >= 7.0
 *   B  >= 5.0
 *   C  <  5.0
 */

import type { InstrumentDef, ScoreResult, PredictionWeights, Grade } from './types'

// ── Indicator utilities ───────────────────────────────────────────────────────

function sma(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0
  const slice = values.slice(-period)
  return slice.reduce((s, v) => s + v, 0) / period
}

/** True Range for a single bar */
function trueRange(high: number, low: number, prevClose: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
}

/** Average True Range (Wilder's smoothed) approximated via SMA for simplicity */
function atr(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (closes.length < period + 1) return highs[highs.length - 1] - lows[lows.length - 1]
  const trs: number[] = []
  for (let i = 1; i < closes.length; i++) {
    trs.push(trueRange(highs[i], lows[i], closes[i - 1]))
  }
  return sma(trs, period)
}

/** 14-period RSI */
function rsi14(closes: number[]): number {
  if (closes.length < 15) return 50
  const gains: number[] = []
  const losses: number[] = []
  for (let i = closes.length - 14; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    gains.push(diff > 0 ? diff : 0)
    losses.push(diff < 0 ? -diff : 0)
  }
  const avgGain = gains.reduce((s, v) => s + v, 0) / 14
  const avgLoss = losses.reduce((s, v) => s + v, 0) / 14
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** Classic floor trader pivot + S1/R1 */
function pivotLevels(high: number, low: number, close: number) {
  const pivot = (high + low + close) / 3
  const r1 = 2 * pivot - low
  const s1 = 2 * pivot - high
  return { pivot, r1, s1 }
}

// ── OHLCV type for the scorer ─────────────────────────────────────────────────

export interface OHLCVBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// ── Main scoring function ─────────────────────────────────────────────────────

/**
 * Score a single instrument from its OHLCV history.
 *
 * @param instrument - Instrument definition (ticker, name, type, point_value)
 * @param bars       - 60-day OHLCV bars, chronological order (oldest first)
 * @param weights    - Active prediction_weights row for domain='trading'
 * @returns ScoreResult with grade, prices, and human-readable reasons
 */
export function scoreInstrument(
  instrument: InstrumentDef,
  bars: OHLCVBar[],
  weights: PredictionWeights
): ScoreResult {
  if (bars.length < 20) {
    // Not enough history — return a C grade stub
    const last = bars[bars.length - 1]
    const price = last?.close ?? 0
    return {
      ticker: instrument.ticker,
      name: instrument.name,
      type: instrument.type,
      direction: 'long',
      score: 0,
      weighted_score: 0,
      grade: 'C',
      confidence: 0,
      entry_price: price,
      stop_price: price * 0.99,
      target_price: price * 1.02,
      atr: 0,
      risk_reward: 1,
      reasons: ['Insufficient price history for scoring'],
      weights_used: weights,
    }
  }

  const closes = bars.map((b) => b.close)
  const highs = bars.map((b) => b.high)
  const lows = bars.map((b) => b.low)
  const volumes = bars.map((b) => b.volume)

  const last = bars[bars.length - 1]
  const price = last.close

  // Technical indicators
  const ma20 = sma(closes, 20)
  const ma50 = sma(closes, Math.min(50, closes.length))
  const rsiVal = rsi14(closes)
  const atrVal = atr(highs, lows, closes)
  const vol20avg = sma(volumes, 20)
  const volRatio = vol20avg > 0 ? last.volume / vol20avg : 1

  // 5-day momentum
  const price5dAgo = closes[closes.length - 6] ?? closes[0]
  const momentum5d = price5dAgo > 0 ? ((price - price5dAgo) / price5dAgo) * 100 : 0

  // Determine primary direction via trend alignment
  const longTrendStrong = price > ma20 && ma20 > ma50
  const shortTrendStrong = price < ma20 && ma20 < ma50
  const direction: 'long' | 'short' = momentum5d >= 0 ? 'long' : 'short'

  // ── Score components ──────────────────────────────────────────────────────

  // Trend (0–3)
  let trendScore = 0
  if (direction === 'long') {
    if (longTrendStrong) trendScore = 3
    else if (price > ma20 || ma20 > ma50) trendScore = 1
  } else {
    if (shortTrendStrong) trendScore = 3
    else if (price < ma20 || ma20 < ma50) trendScore = 1
  }

  // RSI (0–2)
  let rsiScore = 0
  if (direction === 'long') {
    if (rsiVal >= 40 && rsiVal <= 65) rsiScore = 2
    else if ((rsiVal >= 30 && rsiVal < 40) || (rsiVal > 65 && rsiVal <= 75)) rsiScore = 1
  } else {
    if (rsiVal >= 35 && rsiVal <= 60) rsiScore = 2
    else if ((rsiVal > 60 && rsiVal <= 70) || (rsiVal >= 25 && rsiVal < 35)) rsiScore = 1
  }

  // Volume (0–2)
  let volScore = 0
  if (volRatio >= 1.5) volScore = 2
  else if (volRatio >= 1.0) volScore = 1

  // Momentum (0–2)
  let momentumScore = 0
  const absMom = Math.abs(momentum5d)
  if (direction === 'long') {
    if (momentum5d > 2) momentumScore = 2
    else if (momentum5d > 0.5) momentumScore = 1
  } else {
    if (momentum5d < -2) momentumScore = 2
    else if (momentum5d < -0.5) momentumScore = 1
  }
  void absMom // suppress unused warning

  // Pivot level (0–2) — use prior bar's H/L/C for pivot
  const prevBar = bars[bars.length - 2] ?? last
  const { r1, s1 } = pivotLevels(prevBar.high, prevBar.low, prevBar.close)
  let levelScore = 0
  const pivotRef = direction === 'long' ? s1 : r1
  const distPct = price > 0 ? Math.abs(price - pivotRef) / price : 1
  if (distPct <= 0.01) levelScore = 2
  else if (distPct <= 0.02) levelScore = 1

  // Streak bonus (0–1)
  let streakScore = 0
  let streak = 0
  for (let i = closes.length - 1; i > 0 && streak < 3; i--) {
    const up = closes[i] > closes[i - 1]
    if (direction === 'long' ? up : !up) streak++
    else break
  }
  if (streak >= 3) streakScore = 1

  // ── Weighted scoring ──────────────────────────────────────────────────────

  const rawScore = trendScore + rsiScore + volScore + momentumScore + levelScore + streakScore

  const weightedScore =
    trendScore * weights.trend_weight +
    rsiScore * weights.rsi_weight +
    volScore * weights.volume_weight +
    momentumScore * weights.momentum_weight +
    levelScore * weights.level_weight +
    streakScore // streak bonus not weighted per spec

  // ── Grade ─────────────────────────────────────────────────────────────────

  let grade: Grade
  if (weightedScore >= 9.0) grade = 'A'
  else if (weightedScore >= 7.0) grade = 'B+'
  else if (weightedScore >= 5.0) grade = 'B'
  else grade = 'C'

  // Confidence: scale 0–10 based on weighted_score / max_possible
  const maxWeighted =
    3 * weights.trend_weight +
    2 * weights.rsi_weight +
    2 * weights.volume_weight +
    2 * weights.momentum_weight +
    2 * weights.level_weight +
    1
  const confidence = maxWeighted > 0 ? Math.min(10, (weightedScore / maxWeighted) * 10) : 0

  // ── Entry / stop / target ─────────────────────────────────────────────────

  const entry_price = price
  const stop_price =
    direction === 'long'
      ? Math.max(0, entry_price - atrVal * weights.atr_stop_mult)
      : entry_price + atrVal * weights.atr_stop_mult

  const target_price =
    direction === 'long'
      ? entry_price + atrVal * weights.atr_target_mult
      : Math.max(0, entry_price - atrVal * weights.atr_target_mult)

  const risk = Math.abs(entry_price - stop_price)
  const reward = Math.abs(target_price - entry_price)
  const risk_reward = risk > 0 ? reward / risk : 0

  // ── Human-readable reasons ────────────────────────────────────────────────

  const reasons: string[] = []
  if (trendScore === 3)
    reasons.push(`Trend aligned: price > MA20 > MA50 (${direction.toUpperCase()})`)
  else if (trendScore === 1) reasons.push('Partial trend alignment — MAs mixed')

  if (rsiScore === 2) reasons.push(`RSI ${rsiVal.toFixed(0)} in confirmation zone`)
  else if (rsiScore === 1) reasons.push(`RSI ${rsiVal.toFixed(0)} borderline`)

  if (volScore === 2) reasons.push(`Volume ${volRatio.toFixed(1)}× avg — strong interest`)
  else if (volScore === 1) reasons.push(`Volume near avg (${volRatio.toFixed(1)}×)`)

  if (momentumScore === 2) reasons.push(`5-day momentum ${momentum5d.toFixed(1)}% — strong`)
  else if (momentumScore === 1) reasons.push(`5-day momentum ${momentum5d.toFixed(1)}%`)

  if (levelScore >= 1) reasons.push(`Near pivot ${direction === 'long' ? 'S1' : 'R1'} level`)

  if (streakScore === 1) reasons.push('3+ day streak in direction')

  // Guarantee at least 2 reasons
  if (reasons.length === 0) reasons.push('No strong confirmations', `Grade: ${grade}`)
  else if (reasons.length === 1) reasons.push(`Grade: ${grade} — score ${rawScore}/13`)

  return {
    ticker: instrument.ticker,
    name: instrument.name,
    type: instrument.type,
    direction,
    score: rawScore,
    weighted_score: parseFloat(weightedScore.toFixed(2)),
    grade,
    confidence: parseFloat(confidence.toFixed(2)),
    entry_price,
    stop_price: parseFloat(stop_price.toFixed(4)),
    target_price: parseFloat(target_price.toFixed(4)),
    atr: parseFloat(atrVal.toFixed(4)),
    risk_reward: parseFloat(risk_reward.toFixed(2)),
    reasons: reasons.slice(0, 4),
    weights_used: weights,
  }
}

/**
 * Assign a grade from a weighted_score (exported for tests and the learn route).
 * Separated from scoreInstrument so it can be called after weights are changed.
 */
export function gradeFromScore(weightedScore: number): Grade {
  if (weightedScore >= 9.0) return 'A'
  if (weightedScore >= 7.0) return 'B+'
  if (weightedScore >= 5.0) return 'B'
  return 'C'
}
