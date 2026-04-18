/**
 * Kelly criterion acceptance tests.
 *
 * All expected values verified against Python source:
 *   streamlit_app/pages/3_Sports_Betting.py — _kelly_fraction (line 361)
 *   streamlit_app/pages/3_Sports_Betting.py — _kelly_pct (line 1136)
 *
 * Verified 2026-04-18 by running _kelly_fraction(p, o) before writing this file.
 * Three values from audits/sprint2-port-plan.md were wrong; corrected here.
 * See docs/hallucination-log.md for details.
 */

import { describe, it, expect } from 'vitest'
import {
  americanToDecimal,
  americanToImpliedProb,
  kellyFraction,
  kellyPct,
  kellyStake,
} from '@/lib/kelly'

// ── americanToDecimal ─────────────────────────────────────────────────────────

describe('americanToDecimal', () => {
  it('-150 → 1.6667', () => expect(americanToDecimal(-150)).toBeCloseTo(1.6667, 4))
  it('+120 → 2.2000', () => expect(americanToDecimal(120)).toBeCloseTo(2.2, 4))
  it('-110 → 1.9091', () => expect(americanToDecimal(-110)).toBeCloseTo(1.9091, 4))
  it('+100 → 2.0000 (even money)', () => expect(americanToDecimal(100)).toBeCloseTo(2.0, 4))
  it('-100 → 2.0000 (even money, negative form)', () =>
    expect(americanToDecimal(-100)).toBeCloseTo(2.0, 4))
})

// ── americanToImpliedProb ─────────────────────────────────────────────────────

describe('americanToImpliedProb', () => {
  it('-150 → 0.6000', () => expect(americanToImpliedProb(-150)).toBeCloseTo(0.6, 4))
  it('+120 → 0.4545', () => expect(americanToImpliedProb(120)).toBeCloseTo(0.4545, 4))
  it('-110 → 0.5238', () => expect(americanToImpliedProb(-110)).toBeCloseTo(0.5238, 4))
  it('+100 → 0.5000 (even money)', () => expect(americanToImpliedProb(100)).toBeCloseTo(0.5, 4))
  it('-100 → 0.5000 (even money, negative form)', () =>
    expect(americanToImpliedProb(-100)).toBeCloseTo(0.5, 4))
})

// ── kellyFraction — 10 numerical cases from port plan (verified against Python) ──

describe('kellyFraction — numerical equivalence with Python _kelly_fraction', () => {
  // Verified values; see docs/hallucination-log.md for 3 corrected entries.
  it('0.600 at -150 → 0.0000 (no edge — win prob equals implied)', () =>
    expect(kellyFraction(0.6, -150)).toBe(0))

  it('0.650 at -150 → 0.1250', () =>
    expect(kellyFraction(0.65, -150)).toBeCloseTo(0.125, 4))

  it('0.700 at -150 → 0.2500', () =>
    expect(kellyFraction(0.7, -150)).toBeCloseTo(0.25, 4))

  it('0.550 at -110 → 0.0550 (was 0.050 in spec — corrected)', () =>
    expect(kellyFraction(0.55, -110)).toBeCloseTo(0.055, 4))

  it('0.600 at -110 → 0.1600 (was 0.145 in spec — corrected)', () =>
    expect(kellyFraction(0.6, -110)).toBeCloseTo(0.16, 4))

  it('0.400 at +120 → 0.0000 (negative edge → clamp to 0)', () =>
    expect(kellyFraction(0.4, 120)).toBe(0))

  it('0.500 at +120 → 0.0833 (was 0.091 in spec — corrected)', () =>
    expect(kellyFraction(0.5, 120)).toBeCloseTo(0.0833, 4))

  it('0.550 at +120 → 0.1750 (was 0.182 in spec — corrected)', () =>
    expect(kellyFraction(0.55, 120)).toBeCloseTo(0.175, 4))

  it('0.450 at -150 → 0.0000 (negative edge → clamp to 0)', () =>
    expect(kellyFraction(0.45, -150)).toBe(0))

  it('1.000 at -150 → 1.0000 (certainty → full bankroll)', () =>
    expect(kellyFraction(1.0, -150)).toBeCloseTo(1.0, 4))
})

// ── kellyFraction — edge cases ────────────────────────────────────────────────

describe('kellyFraction — edge cases', () => {
  it('win_prob=0 → 0 (no chance of winning)', () =>
    expect(kellyFraction(0, -110)).toBe(0))

  it('win_prob=1 at -110 → 1.0 (certainty)', () =>
    expect(kellyFraction(1.0, -110)).toBeCloseTo(1.0, 4))

  it('win_prob=0.5 at -110 → 0 (implied prob > win prob)', () =>
    expect(kellyFraction(0.5, -110)).toBe(0))

  it('win_prob=0.5 at -150 → 0 (implied 0.600 > win prob)', () =>
    expect(kellyFraction(0.5, -150)).toBe(0))

  it('win_prob=0.5 at +100 → 0 (exactly break-even at even money)', () =>
    expect(kellyFraction(0.5, 100)).toBe(0))

  it('win_prob=0.5 at -100 → 0 (exactly break-even at even money)', () =>
    expect(kellyFraction(0.5, -100)).toBe(0))

  it('never returns negative (always clamped to 0)', () => {
    // A range of unfavorable win probs should always yield 0, never negative
    const unfavorable = [0.1, 0.3, 0.4, 0.45, 0.5, 0.55, 0.59]
    for (const p of unfavorable) {
      expect(kellyFraction(p, -150)).toBeGreaterThanOrEqual(0)
    }
  })
})

// ── kellyPct — percentage form ────────────────────────────────────────────────

describe('kellyPct = kellyFraction × 100', () => {
  it('0.650 at -150 → 12.50%', () =>
    expect(kellyPct(0.65, -150)).toBeCloseTo(12.5, 3))

  it('0.400 at +120 → 0% (no edge)', () =>
    expect(kellyPct(0.4, 120)).toBe(0))

  it('0.550 at -110 → 5.50%', () =>
    expect(kellyPct(0.55, -110)).toBeCloseTo(5.5, 3))

  it('always equals kellyFraction × 100', () => {
    const cases: [number, number][] = [
      [0.65, -150],
      [0.7, -110],
      [0.55, 120],
    ]
    for (const [p, o] of cases) {
      expect(kellyPct(p, o)).toBeCloseTo(kellyFraction(p, o) * 100, 8)
    }
  })
})

// ── kellyStake ────────────────────────────────────────────────────────────────

describe('kellyStake', () => {
  it('quarter Kelly (default) on $1000: 0.65/-150 → $31.25', () =>
    expect(kellyStake(0.65, -150, 1000)).toBeCloseTo(31.25, 4))

  it('explicit fraction=0.25 matches default', () =>
    expect(kellyStake(0.65, -150, 1000, 0.25)).toBeCloseTo(31.25, 4))

  it('fraction=0.5 (half Kelly): 0.65/-150 → $62.50', () =>
    expect(kellyStake(0.65, -150, 1000, 0.5)).toBeCloseTo(62.5, 4))

  it('fraction=1.0 (full Kelly): 0.65/-150 → $125.00', () =>
    expect(kellyStake(0.65, -150, 1000, 1.0)).toBeCloseTo(125.0, 4))

  it('zero stake when no edge', () =>
    expect(kellyStake(0.55, -150, 1000)).toBe(0))

  it('fraction=0.5 on 0.55/-110: $27.50', () =>
    expect(kellyStake(0.55, -110, 1000, 0.5)).toBeCloseTo(27.5, 4))

  it('scales linearly with bankroll', () => {
    const at1000 = kellyStake(0.65, -150, 1000)
    const at2000 = kellyStake(0.65, -150, 2000)
    expect(at2000).toBeCloseTo(at1000 * 2, 8)
  })
})
