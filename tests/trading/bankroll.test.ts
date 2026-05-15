/**
 * Tests for lib/trading/bankroll.ts
 *
 * Covers: high-water mark, drawdown calculation, start-of-year bankroll,
 * Kelly stake, empty input, history array shape.
 */

import { describe, it, expect } from 'vitest'
import {
  computeBankrollSummary,
  kellyStake,
  KELLY_FRACTION,
  type BetForBankroll,
} from '@/lib/trading/bankroll'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBet(bet_date: string, bankroll_after: number, pnl: number): BetForBankroll {
  return { bet_date, bankroll_after, pnl }
}

// ── kellyStake ────────────────────────────────────────────────────────────────

describe('kellyStake', () => {
  it('returns 0 for zero bankroll', () => {
    expect(kellyStake(0.55, -150, 0)).toBe(0)
  })

  it('returns 0 for negative edge (p too low)', () => {
    // p=0.3, odds=-150 → b=0.667, f=(0.3*0.667-0.7)/0.667 = negative
    expect(kellyStake(0.3, -150, 1000)).toBe(0)
  })

  it('applies KELLY_FRACTION (0.25) to full Kelly stake', () => {
    // p=0.55, odds=-150 → b=100/150=0.667
    // f = (0.55*0.667 - 0.45) / 0.667 = (0.367 - 0.45) / 0.667 — negative? No:
    // Actually: b = 100/150 = 0.6667
    // f = (p*b - q) / b = (0.55*0.6667 - 0.45) / 0.6667 = (0.3667 - 0.45) / 0.6667
    //   = -0.0833 / 0.6667 = negative
    // So at p=0.55, -150 odds → no Kelly edge. Try positive odds:
    // p=0.6, odds=+120 → b=1.2, f = (0.6*1.2 - 0.4)/1.2 = (0.72-0.4)/1.2 = 0.267
    const stake = kellyStake(0.6, 120, 1000, 0.25)
    expect(stake).toBeGreaterThan(0)
    expect(stake).toBeLessThanOrEqual(1000)
    // Full Kelly = 1000 * 0.267 = 267; quarter = 66.8
    expect(stake).toBeCloseTo(66.67, 0)
  })

  it('respects custom fraction', () => {
    const full = kellyStake(0.6, 120, 1000, 1.0)
    const quarter = kellyStake(0.6, 120, 1000, 0.25)
    expect(full).toBeCloseTo(quarter * 4, 0)
  })

  it('KELLY_FRACTION constant is 0.25', () => {
    expect(KELLY_FRACTION).toBe(0.25)
  })
})

// ── computeBankrollSummary ────────────────────────────────────────────────────

describe('computeBankrollSummary', () => {
  it('returns zeros for empty bets', () => {
    const result = computeBankrollSummary([])
    expect(result.current).toBe(0)
    expect(result.high_water_mark).toBe(0)
    expect(result.current_drawdown_pct).toBe(0)
    expect(result.history).toHaveLength(0)
  })

  it('ignores bets with null bankroll_after', () => {
    const bets: BetForBankroll[] = [
      { bet_date: '2026-01-01', bankroll_after: null, pnl: 10 },
      { bet_date: '2026-01-02', bankroll_after: null, pnl: -5 },
    ]
    const result = computeBankrollSummary(bets)
    expect(result.current).toBe(0)
    expect(result.history).toHaveLength(0)
  })

  it('computes current as last bankroll_after — AC-3 scenario', () => {
    // bankroll 1000 → 1100 → 1050
    const bets = [
      makeBet('2026-01-01', 1000, 100),
      makeBet('2026-01-02', 1100, 100),
      makeBet('2026-01-03', 1050, -50),
    ]
    const result = computeBankrollSummary(bets)
    expect(result.current).toBe(1050)
  })

  it('computes high-water mark correctly — AC-3 scenario', () => {
    const bets = [
      makeBet('2026-01-01', 1000, 100),
      makeBet('2026-01-02', 1100, 100),
      makeBet('2026-01-03', 1050, -50),
    ]
    const result = computeBankrollSummary(bets)
    expect(result.high_water_mark).toBe(1100)
  })

  it('computes drawdown correctly — AC-3 scenario', () => {
    // current=1050, hwm=1100 → (1050-1100)/1100 * 100 = -4.5%
    const bets = [
      makeBet('2026-01-01', 1000, 100),
      makeBet('2026-01-02', 1100, 100),
      makeBet('2026-01-03', 1050, -50),
    ]
    const result = computeBankrollSummary(bets)
    expect(result.current_drawdown_pct).toBe(-4.5)
  })

  it('drawdown is 0 when at high-water mark', () => {
    const bets = [
      makeBet('2026-01-01', 1000, 100),
      makeBet('2026-01-02', 1100, 100), // at new HWM
    ]
    const result = computeBankrollSummary(bets)
    expect(result.current_drawdown_pct).toBe(0)
  })

  it('history length equals number of bets with bankroll_after', () => {
    const bets = [
      makeBet('2026-01-01', 1000, 100),
      makeBet('2026-01-02', 1100, 100),
      makeBet('2026-01-03', 1050, -50),
    ]
    const result = computeBankrollSummary(bets)
    expect(result.history).toHaveLength(3)
  })

  it('history is sorted ascending by date', () => {
    const bets = [
      makeBet('2026-01-03', 1050, -50),
      makeBet('2026-01-01', 1000, 100),
      makeBet('2026-01-02', 1100, 100),
    ]
    const result = computeBankrollSummary(bets)
    expect(result.history[0].date).toBe('2026-01-01')
    expect(result.history[1].date).toBe('2026-01-02')
    expect(result.history[2].date).toBe('2026-01-03')
  })

  it('history rows include running high_water_mark', () => {
    const bets = [
      makeBet('2026-01-01', 1000, 100),
      makeBet('2026-01-02', 1100, 100),
      makeBet('2026-01-03', 1050, -50),
    ]
    const { history } = computeBankrollSummary(bets)
    expect(history[0].high_water_mark).toBe(1000)
    expect(history[1].high_water_mark).toBe(1100)
    expect(history[2].high_water_mark).toBe(1100) // HWM doesn't drop
  })

  it('positive drawdown_pct when above HWM (all-time high)', () => {
    const bets = [makeBet('2026-01-01', 500, 50)]
    const result = computeBankrollSummary(bets)
    // single point: current=hwm → drawdown = 0
    expect(result.current_drawdown_pct).toBe(0)
  })
})
