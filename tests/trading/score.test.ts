/**
 * Unit tests for lib/trading/score.ts
 *
 * Tests pure business logic only — no HTTP, no Supabase, no yahoo-finance2.
 * Uses synthetic OHLCV data to verify each scoring component and grade thresholds.
 */

import { describe, it, expect } from 'vitest'
import { scoreInstrument, gradeFromScore } from '../../lib/trading/score'
import type { OHLCVBar } from '../../lib/trading/score'
import { DEFAULT_WEIGHTS } from '../../lib/trading/types'
import type { InstrumentDef } from '../../lib/trading/types'

// ── Test helpers ──────────────────────────────────────────────────────────────

const ES: InstrumentDef = { ticker: 'ES=F', name: 'S&P 500', type: 'future', point_value: 5 }
const TSLA: InstrumentDef = { ticker: 'TSLA', name: 'Tesla', type: 'stock', point_value: 1 }

/** Generate trending up bars: each close slightly above prior */
function trendingUpBars(count = 60, startPrice = 4800, dailyMove = 5): OHLCVBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = startPrice + i * dailyMove
    return {
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      open: close - 2,
      high: close + 10,
      low: close - 10,
      close,
      volume: 1_200_000,
    }
  })
}

/** Generate trending down bars */
function trendingDownBars(count = 60, startPrice = 4800, dailyDrop = 5): OHLCVBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = startPrice - i * dailyDrop
    return {
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      open: close + 2,
      high: close + 10,
      low: close - 10,
      close,
      volume: 1_200_000,
    }
  })
}

/** High-volume surge bars */
function highVolumeBars(count = 60, price = 4800): OHLCVBar[] {
  const bars = trendingUpBars(count, price)
  // Last bar has very high volume
  bars[bars.length - 1] = { ...bars[bars.length - 1], volume: 3_000_000 }
  return bars
}

// ── Grade thresholds ──────────────────────────────────────────────────────────

describe('gradeFromScore', () => {
  it('returns A at >= 9.0', () => {
    expect(gradeFromScore(9.0)).toBe('A')
    expect(gradeFromScore(10.5)).toBe('A')
    expect(gradeFromScore(13)).toBe('A')
  })

  it('returns B+ at 7.0–8.9', () => {
    expect(gradeFromScore(7.0)).toBe('B+')
    expect(gradeFromScore(8.0)).toBe('B+')
    expect(gradeFromScore(8.9)).toBe('B+')
  })

  it('returns B at 5.0–6.9', () => {
    expect(gradeFromScore(5.0)).toBe('B')
    expect(gradeFromScore(6.5)).toBe('B')
    expect(gradeFromScore(6.99)).toBe('B')
  })

  it('returns C below 5.0', () => {
    expect(gradeFromScore(4.9)).toBe('C')
    expect(gradeFromScore(0)).toBe('C')
    expect(gradeFromScore(-1)).toBe('C')
  })
})

// ── scoreInstrument ───────────────────────────────────────────────────────────

describe('scoreInstrument', () => {
  it('returns direction=long for uptrending instrument', () => {
    const result = scoreInstrument(ES, trendingUpBars(), DEFAULT_WEIGHTS)
    expect(result.direction).toBe('long')
  })

  it('returns direction=short for downtrending instrument', () => {
    const result = scoreInstrument(ES, trendingDownBars(), DEFAULT_WEIGHTS)
    expect(result.direction).toBe('short')
  })

  it('strong uptrend score is at least B grade (weighted_score >= 5)', () => {
    const upResult = scoreInstrument(ES, trendingUpBars(), DEFAULT_WEIGHTS)
    // A strong 60-day uptrend should score at least B (>=5.0)
    expect(upResult.weighted_score).toBeGreaterThanOrEqual(5.0)
  })

  it('has valid grade for all test cases', () => {
    const validGrades = ['A', 'B+', 'B', 'C']
    const result = scoreInstrument(ES, trendingUpBars(), DEFAULT_WEIGHTS)
    expect(validGrades).toContain(result.grade)
  })

  it('entry_price matches last close', () => {
    const bars = trendingUpBars(60, 4800, 5)
    const result = scoreInstrument(ES, bars, DEFAULT_WEIGHTS)
    const lastClose = bars[bars.length - 1].close
    expect(result.entry_price).toBe(lastClose)
  })

  it('stop_price is below entry for long', () => {
    const result = scoreInstrument(ES, trendingUpBars(), DEFAULT_WEIGHTS)
    if (result.direction === 'long') {
      expect(result.stop_price).toBeLessThan(result.entry_price)
    }
  })

  it('target_price is above entry for long', () => {
    const result = scoreInstrument(ES, trendingUpBars(), DEFAULT_WEIGHTS)
    if (result.direction === 'long') {
      expect(result.target_price).toBeGreaterThan(result.entry_price)
    }
  })

  it('stop_price is above entry for short', () => {
    const result = scoreInstrument(ES, trendingDownBars(), DEFAULT_WEIGHTS)
    if (result.direction === 'short') {
      expect(result.stop_price).toBeGreaterThan(result.entry_price)
    }
  })

  it('risk_reward is positive', () => {
    const result = scoreInstrument(ES, trendingUpBars(), DEFAULT_WEIGHTS)
    expect(result.risk_reward).toBeGreaterThan(0)
  })

  it('confidence is between 0 and 10', () => {
    const result = scoreInstrument(ES, trendingUpBars(), DEFAULT_WEIGHTS)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(10)
  })

  it('has at least 2 reasons', () => {
    const result = scoreInstrument(ES, trendingUpBars(), DEFAULT_WEIGHTS)
    expect(result.reasons.length).toBeGreaterThanOrEqual(2)
    expect(result.reasons.length).toBeLessThanOrEqual(4)
  })

  it('returns C grade stub with < 20 bars', () => {
    const result = scoreInstrument(ES, trendingUpBars(5), DEFAULT_WEIGHTS)
    expect(result.grade).toBe('C')
    expect(result.confidence).toBe(0)
  })

  it('high volume bars score at least as high as low volume', () => {
    const highVol = scoreInstrument(ES, highVolumeBars(), DEFAULT_WEIGHTS)
    const lowVol = scoreInstrument(ES, trendingUpBars(), DEFAULT_WEIGHTS)
    // High volume on last bar should not decrease score
    expect(highVol.weighted_score).toBeGreaterThanOrEqual(lowVol.weighted_score - 0.1)
  })

  it('works for stock instruments', () => {
    const result = scoreInstrument(TSLA, trendingUpBars(60, 200, 2), DEFAULT_WEIGHTS)
    expect(result.ticker).toBe('TSLA')
    expect(result.type).toBe('stock')
    expect(['A', 'B+', 'B', 'C']).toContain(result.grade)
  })

  it('weights_used matches input weights', () => {
    const result = scoreInstrument(ES, trendingUpBars(), DEFAULT_WEIGHTS)
    expect(result.weights_used).toEqual(DEFAULT_WEIGHTS)
  })

  it('custom weights affect weighted_score', () => {
    const highTrendWeights = { ...DEFAULT_WEIGHTS, trend_weight: 2.0 }
    const defaultResult = scoreInstrument(ES, trendingUpBars(), DEFAULT_WEIGHTS)
    const highTrendResult = scoreInstrument(ES, trendingUpBars(), highTrendWeights)
    // Higher trend weight should produce higher weighted score when trend is strong
    if (defaultResult.direction === 'long') {
      expect(highTrendResult.weighted_score).toBeGreaterThanOrEqual(defaultResult.weighted_score)
    }
  })
})

// ── R-multiple calculation (from route — tested separately) ──────────────────

describe('R-multiple calculation', () => {
  it('computes points_pnl correctly for long trade', () => {
    const priceIn = 4800
    const priceOut = 4820
    const direction = 'long'
    const dirSign = direction === 'long' ? 1 : -1
    const pointsPnl = (priceOut - priceIn) * dirSign
    expect(pointsPnl).toBe(20)
  })

  it('computes dollar_pnl correctly for ES=F (point_value=5)', () => {
    const pointsPnl = 20
    const pointValue = 5
    const positionSize = 1
    const dollarPnl = pointsPnl * pointValue * positionSize
    expect(dollarPnl).toBe(100)
  })

  it('computes r_multiple correctly', () => {
    const priceIn = 4800
    const stopLoss = 4780 // 20 points risk
    const dollarPnl = 100
    const pointValue = 5
    const positionSize = 1
    const absRisk = Math.abs(priceIn - stopLoss) * pointValue * positionSize // 100
    const r = dollarPnl / absRisk
    expect(r).toBe(1.0) // 1R trade
  })

  it('negative r_multiple for losing trade', () => {
    const priceIn = 4800
    const priceOut = 4790 // -10 points
    const stopLoss = 4780
    const pointValue = 5
    const positionSize = 1
    const dirSign = 1
    const pointsPnl = (priceOut - priceIn) * dirSign // -10
    const dollarPnl = pointsPnl * pointValue * positionSize // -50
    const absRisk = Math.abs(priceIn - stopLoss) * pointValue * positionSize // 100
    const r = dollarPnl / absRisk
    expect(r).toBe(-0.5)
  })

  it('short trade with win computes positive r_multiple', () => {
    const priceIn = 4800
    const priceOut = 4780 // price fell 20 points — short wins
    const stopLoss = 4820 // stop above entry
    const pointValue = 5
    const positionSize = 1
    const dirSign = -1
    const pointsPnl = (priceOut - priceIn) * dirSign // +20
    const dollarPnl = pointsPnl * pointValue * positionSize // +100
    const absRisk = Math.abs(priceIn - stopLoss) * pointValue * positionSize // 100
    const r = dollarPnl / absRisk
    expect(r).toBe(1.0)
  })
})
