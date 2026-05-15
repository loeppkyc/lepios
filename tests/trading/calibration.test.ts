/**
 * Tests for lib/trading/calibration.ts
 *
 * Covers: bucket assignment, actual win-rate calculation, edge sign,
 * minimum sample-size filter, sort order.
 */

import { describe, it, expect } from 'vitest'
import {
  computeCalibration,
  CALIBRATION_MIN_BUCKET_SIZE,
  type BetForCalibration,
} from '@/lib/trading/calibration'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBet(win_prob_pct: number | null, result: 'win' | 'loss'): BetForCalibration {
  return { win_prob_pct, result }
}

function makeN(win_prob_pct: number, wins: number, losses: number): BetForCalibration[] {
  return [
    ...Array(wins)
      .fill(null)
      .map(() => makeBet(win_prob_pct, 'win')),
    ...Array(losses)
      .fill(null)
      .map(() => makeBet(win_prob_pct, 'loss')),
  ]
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeCalibration', () => {
  it('returns empty array when no eligible bets', () => {
    expect(computeCalibration([])).toEqual([])
  })

  it('excludes bets without win_prob_pct', () => {
    const bets: BetForCalibration[] = [
      { win_prob_pct: null, result: 'win' },
      { win_prob_pct: null, result: 'loss' },
      { win_prob_pct: null, result: 'win' },
    ]
    expect(computeCalibration(bets)).toEqual([])
  })

  it('excludes pending and push bets', () => {
    const bets: BetForCalibration[] = [
      { win_prob_pct: 60, result: 'pending' },
      { win_prob_pct: 60, result: 'push' },
      { win_prob_pct: 60, result: 'void' },
    ]
    expect(computeCalibration(bets)).toEqual([])
  })

  it('excludes bucket with < 3 bets (min sample size)', () => {
    const bets = makeN(62, 1, 1) // only 2 bets at 62% → not enough
    expect(computeCalibration(bets)).toEqual([])
    expect(CALIBRATION_MIN_BUCKET_SIZE).toBe(3)
  })

  it('includes bucket at exactly minimum sample size', () => {
    const bets = makeN(62, 2, 1) // 3 bets at 62%: 2 wins, 1 loss
    const result = computeCalibration(bets)
    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(3)
  })

  it('computes actual win rate correctly', () => {
    // 62% is in the 60-65 bucket (midpoint 62.5)
    // 4 wins, 1 loss → actual = 80%
    const bets = makeN(62, 4, 1)
    const result = computeCalibration(bets)
    expect(result).toHaveLength(1)
    expect(result[0].actual).toBe(80)
    expect(result[0].predicted).toBe(62.5) // midpoint of 60-65 bucket
  })

  it('computes edge as actual - predicted', () => {
    // 62% bucket: actual = 80%, predicted midpoint = 62.5
    // edge = 80 - 62.5 = 17.5 (underconfident: guessed too low)
    const bets = makeN(62, 4, 1)
    const result = computeCalibration(bets)
    expect(result[0].edge).toBe(17.5)
  })

  it('negative edge = overconfident', () => {
    // 62% bucket: 1 win, 4 losses → actual = 20%, predicted = 62.5
    // edge = 20 - 62.5 = -42.5
    const bets = makeN(62, 1, 4)
    const result = computeCalibration(bets)
    expect(result[0].edge).toBe(-42.5)
  })

  it('returns buckets sorted ascending by predicted', () => {
    const bets: BetForCalibration[] = [
      ...makeN(72, 3, 0), // 70-80 bucket, predicted 75
      ...makeN(52, 2, 1), // 50-55 bucket, predicted 52.5
      ...makeN(62, 2, 1), // 60-65 bucket, predicted 62.5
    ]
    const result = computeCalibration(bets)
    expect(result.length).toBe(3)
    expect(result[0].predicted).toBe(52.5)
    expect(result[1].predicted).toBe(62.5)
    expect(result[2].predicted).toBe(75)
  })

  it('80+ bucket includes bets at 80 and above', () => {
    const bets: BetForCalibration[] = [makeBet(80, 'win'), makeBet(85, 'win'), makeBet(95, 'loss')]
    const result = computeCalibration(bets)
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('80+%')
    // 2 wins, 1 loss → actual = 66.7
    expect(result[0].actual).toBeCloseTo(66.7, 0)
  })

  it('multiple buckets populated correctly — AC-1 scenario', () => {
    // Simulate 10 mock bets with win_prob_pct + results
    const bets: BetForCalibration[] = [
      ...makeN(52, 2, 1), // 50-55 bucket: 3 bets, 66.7% actual
      ...makeN(62, 4, 3), // 60-65 bucket: 7 bets, 57.1% actual
    ]
    const result = computeCalibration(bets)
    expect(result).toHaveLength(2)
    // Check label strings
    expect(result[0].label).toBe('50–55%')
    expect(result[1].label).toBe('60–65%')
    // Verify counts
    expect(result[0].count).toBe(3)
    expect(result[1].count).toBe(7)
  })
})
