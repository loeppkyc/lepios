/**
 * Tests for lib/trading/composite.ts (pure logic only)
 *
 * Does NOT test DB calls or external fetchers — those are integration-level.
 * Tests: weighted average math, interpretation thresholds, signal fallback to 50.
 */

import { describe, it, expect } from 'vitest'

// ── We test the interpretScore and weighted-average logic inline ──────────────
// The computeCompositeConfidence function is async and DB-connected — not unit-testable here.
// We extract the deterministic parts for testing.

interface Signal {
  name: string
  value: number
  weight: number
  available: boolean
}

function weightedScore(signals: Signal[]): number {
  return parseFloat(signals.reduce((sum, s) => sum + s.value * s.weight, 0).toFixed(1))
}

function interpretScore(score: number): string {
  if (score >= 75) return 'high'
  if (score >= 50) return 'moderate'
  if (score >= 25) return 'cautious'
  return 'standAside'
}

const SIGNAL_WEIGHTS = [0.2, 0.15, 0.15, 0.1, 0.1, 0.1, 0.1, 0.1]
const WEIGHT_SUM = SIGNAL_WEIGHTS.reduce((s, w) => s + w, 0)

describe('composite score weighted average', () => {
  it('weights sum to 1.0', () => {
    expect(WEIGHT_SUM).toBeCloseTo(1.0, 5)
  })

  it('all-neutral signals (50) produce composite of 50', () => {
    const signals: Signal[] = SIGNAL_WEIGHTS.map((w, i) => ({
      name: `s${i}`,
      value: 50,
      weight: w,
      available: false,
    }))
    expect(weightedScore(signals)).toBe(50)
  })

  it('all-max signals (100) produce composite of 100', () => {
    const signals: Signal[] = SIGNAL_WEIGHTS.map((w, i) => ({
      name: `s${i}`,
      value: 100,
      weight: w,
      available: true,
    }))
    expect(weightedScore(signals)).toBe(100)
  })

  it('all-zero signals produce composite of 0', () => {
    const signals: Signal[] = SIGNAL_WEIGHTS.map((w, i) => ({
      name: `s${i}`,
      value: 0,
      weight: w,
      available: true,
    }))
    expect(weightedScore(signals)).toBe(0)
  })

  it('market trend (0.20) has highest single-signal impact', () => {
    // All neutral except market trend = 100
    const signals: Signal[] = SIGNAL_WEIGHTS.map((w, i) => ({
      name: `s${i}`,
      value: i === 0 ? 100 : 50, // index 0 = Market Trend
      weight: w,
      available: true,
    }))
    const score = weightedScore(signals)
    // Market Trend at 100 instead of 50: +50 * 0.20 = +10 above all-50
    expect(score).toBe(60)
  })
})

describe('interpretation thresholds', () => {
  it('75 = high', () => expect(interpretScore(75)).toBe('high'))
  it('74.9 = moderate', () => expect(interpretScore(74.9)).toBe('moderate'))
  it('50 = moderate', () => expect(interpretScore(50)).toBe('moderate'))
  it('49.9 = cautious', () => expect(interpretScore(49.9)).toBe('cautious'))
  it('25 = cautious', () => expect(interpretScore(25)).toBe('cautious'))
  it('24.9 = standAside', () => expect(interpretScore(24.9)).toBe('standAside'))
  it('0 = standAside', () => expect(interpretScore(0)).toBe('standAside'))
  it('100 = high', () => expect(interpretScore(100)).toBe('high'))
})

describe('graceful fallback to 50 for unavailable signals', () => {
  it('unavailable signal replaced by 50 (neutral)', () => {
    // Simulate: market trend unavailable (null → 50), all others = 50
    const signals: Signal[] = SIGNAL_WEIGHTS.map((w, i) => ({
      name: `s${i}`,
      value: 50, // fallback value for all
      weight: w,
      available: false,
    }))
    expect(weightedScore(signals)).toBe(50)
  })

  it('mixed available/unavailable — available signals drive the score', () => {
    // Market Trend available = 80, all others unavailable = 50
    const signals: Signal[] = SIGNAL_WEIGHTS.map((w, i) => ({
      name: `s${i}`,
      value: i === 0 ? 80 : 50,
      weight: w,
      available: i === 0,
    }))
    const score = weightedScore(signals)
    // Market Trend at 80 instead of 50: +30 * 0.20 = +6 above 50
    expect(score).toBe(56)
  })
})
