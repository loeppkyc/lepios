/**
 * Unit tests for lib/harness/safety/v2/scorer.ts.
 *
 * Pure scoring math. Tests cover:
 *   - SECRET_DETECTED auto-high path
 *   - per-key collapse (multiple findings of same key contribute weight once)
 *   - tier classification at boundaries
 *   - missing weight overrides fall back to defaults
 *   - score clamps to [0, 100]
 */

import { describe, it, expect } from 'vitest'
import { scoreSafety } from '@/lib/harness/safety/v2/scorer'
import type { SignalFinding, WeightKey } from '@/lib/harness/safety/v2/types'

const DEFAULT_THRESHOLDS = { lowMax: 29, mediumMax: 70 }

function f(weight_key: WeightKey, id = 'x', evidence = 'e'): SignalFinding {
  return { id, name: id, weight_key, evidence }
}

describe('scoreSafety — SECRET_DETECTED auto-high', () => {
  it('any secret → score 100, tier high, secret_auto_high true', () => {
    const out = scoreSafety({
      findings: [f('SAFETY_WEIGHT_SECRET_DETECTED')],
      weights: {},
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(out.score).toBe(100)
    expect(out.tier).toBe('high')
    expect(out.secret_auto_high).toBe(true)
  })

  it('secret + many other findings still scores 100 (no double count)', () => {
    const out = scoreSafety({
      findings: [
        f('SAFETY_WEIGHT_SECRET_DETECTED'),
        f('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE'),
        f('SAFETY_WEIGHT_SHARED_SEAM_TOUCH'),
      ],
      weights: {},
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(out.score).toBe(100)
    expect(out.tier).toBe('high')
    expect(out.contributions).toHaveLength(1)
    expect(out.contributions[0].weight_key).toBe('SAFETY_WEIGHT_SECRET_DETECTED')
  })

  it('records finding count even when capped', () => {
    const out = scoreSafety({
      findings: [
        f('SAFETY_WEIGHT_SECRET_DETECTED', 'aws'),
        f('SAFETY_WEIGHT_SECRET_DETECTED', 'jwt'),
      ],
      weights: {},
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(out.contributions[0].finding_count).toBe(2)
  })
})

describe('scoreSafety — per-key collapse (no runaway scores)', () => {
  it('5 destructive ops in same migration contribute +60 once, not +300', () => {
    const out = scoreSafety({
      findings: [
        f('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE', 'drop_a'),
        f('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE', 'drop_b'),
        f('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE', 'truncate_c'),
        f('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE', 'rename_d'),
        f('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE', 'drop_not_null_e'),
      ],
      weights: {},
      thresholds: DEFAULT_THRESHOLDS,
    })
    // base 5 + destructive 60 = 65, NOT 305.
    expect(out.score).toBe(65)
    expect(out.contributions).toHaveLength(1)
    expect(out.contributions[0].finding_count).toBe(5)
  })

  it('different keys each contribute (independent caps)', () => {
    const out = scoreSafety({
      findings: [
        f('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE'),
        f('SAFETY_WEIGHT_SHARED_SEAM_TOUCH'),
        f('SAFETY_WEIGHT_LOC_DELTA_2X'),
      ],
      weights: {},
      thresholds: DEFAULT_THRESHOLDS,
    })
    // base 5 + destructive 60 + seam 40 + loc 20 = 100, clamped at 100.
    expect(out.score).toBe(100)
    expect(out.tier).toBe('high')
    expect(out.contributions).toHaveLength(3)
  })
})

describe('scoreSafety — tier boundaries', () => {
  it('empty findings → score 5 (base), tier low', () => {
    const out = scoreSafety({
      findings: [],
      weights: {},
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(out.score).toBe(5)
    expect(out.tier).toBe('low')
  })

  it('score 29 (lowMax) → low', () => {
    const out = scoreSafety({
      findings: [f('SAFETY_WEIGHT_LOC_DELTA_2X')], // 5 + 20 = 25
      weights: {},
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(out.score).toBe(25)
    expect(out.tier).toBe('low')
  })

  it('score 30 → medium (just above lowMax)', () => {
    const out = scoreSafety({
      findings: [f('SAFETY_WEIGHT_COVERAGE_DROP_5PCT')], // 5 + 30 = 35
      weights: {},
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(out.score).toBe(35)
    expect(out.tier).toBe('medium')
  })

  it('score 70 (mediumMax) → medium', () => {
    const out = scoreSafety({
      findings: [
        f('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE'), // 60
        f('SAFETY_WEIGHT_API_ROUTE_NETNEW'), // 15
      ],
      weights: {},
      thresholds: { lowMax: 29, mediumMax: 80 }, // adjust to test boundary
    })
    expect(out.score).toBe(80)
    expect(out.tier).toBe('medium')
  })

  it('score > mediumMax → high', () => {
    const out = scoreSafety({
      findings: [f('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE'), f('SAFETY_WEIGHT_SHARED_SEAM_TOUCH')],
      weights: {},
      thresholds: DEFAULT_THRESHOLDS,
    })
    // 5 + 60 + 40 = 105 → clamped to 100 → high.
    expect(out.score).toBe(100)
    expect(out.tier).toBe('high')
  })
})

describe('scoreSafety — weight overrides', () => {
  it('override is honored', () => {
    const out = scoreSafety({
      findings: [f('SAFETY_WEIGHT_LOC_DELTA_2X')],
      weights: { SAFETY_WEIGHT_LOC_DELTA_2X: 50, SAFETY_WEIGHT_BASE: 0 },
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(out.score).toBe(50)
  })

  it('missing override falls back to default', () => {
    const out = scoreSafety({
      findings: [f('SAFETY_WEIGHT_LOC_DELTA_2X')],
      weights: {}, // no override → default 20 + base 5 = 25
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(out.score).toBe(25)
  })

  it('negative override is ignored (falls back to default)', () => {
    const out = scoreSafety({
      findings: [f('SAFETY_WEIGHT_LOC_DELTA_2X')],
      weights: { SAFETY_WEIGHT_LOC_DELTA_2X: -5 },
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(out.score).toBe(25) // default
  })

  it('NaN override is ignored', () => {
    const out = scoreSafety({
      findings: [f('SAFETY_WEIGHT_LOC_DELTA_2X')],
      weights: { SAFETY_WEIGHT_LOC_DELTA_2X: NaN },
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(out.score).toBe(25)
  })
})

describe('scoreSafety — clamping', () => {
  it('score clamps to 100 max', () => {
    const out = scoreSafety({
      findings: [
        f('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE'),
        f('SAFETY_WEIGHT_SHARED_SEAM_TOUCH'),
        f('SAFETY_WEIGHT_FAILURE_PATTERN_HIGH'),
      ],
      weights: {},
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(out.score).toBeLessThanOrEqual(100)
  })
})
