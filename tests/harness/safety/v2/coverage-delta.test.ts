/**
 * Unit tests for lib/harness/safety/v2/signals/coverage-delta.ts.
 *
 * Calibration: drop > 5%pt → COVERAGE_DROP_5PCT, drop > 15%pt → COVERAGE_DROP_15PCT.
 * Improvements + small regressions emit nothing.
 */

import { describe, it, expect } from 'vitest'
import {
  detectCoverageDelta,
  aggregatedPct,
  type CoverageSummary,
} from '@/lib/harness/safety/v2/signals/coverage-delta'

function summary(pct: number): CoverageSummary {
  return {
    total: {
      lines: { pct },
      statements: { pct },
      functions: { pct },
      branches: { pct },
    },
  }
}

describe('aggregatedPct', () => {
  it('returns the metric when all four are equal', () => {
    expect(aggregatedPct(summary(80))).toBe(80)
  })

  it('weights all four metrics evenly (0.25 each)', () => {
    const s: CoverageSummary = {
      total: {
        lines: { pct: 100 },
        statements: { pct: 80 },
        functions: { pct: 60 },
        branches: { pct: 40 },
      },
    }
    expect(aggregatedPct(s)).toBe(70) // (100+80+60+40)/4
  })

  it('returns NaN if a metric is missing', () => {
    const s = {
      total: {
        lines: { pct: 80 },
        statements: { pct: 80 },
        functions: { pct: 80 },
      },
    } as unknown as CoverageSummary
    expect(Number.isNaN(aggregatedPct(s))).toBe(true)
  })
})

describe('detectCoverageDelta — flag conditions', () => {
  it('flags 5pt drop as COVERAGE_DROP_5PCT', () => {
    const out = detectCoverageDelta({ base: summary(80), head: summary(74) })
    expect(out).toHaveLength(1)
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_COVERAGE_DROP_5PCT')
    expect(out[0].id).toBe('coverage_drop_5pct')
  })

  it('flags 15pt drop as COVERAGE_DROP_15PCT (only — does not also fire 5pct)', () => {
    const out = detectCoverageDelta({ base: summary(80), head: summary(64) })
    expect(out).toHaveLength(1)
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_COVERAGE_DROP_15PCT')
  })

  it('flags 20pt drop as COVERAGE_DROP_15PCT', () => {
    const out = detectCoverageDelta({ base: summary(80), head: summary(60) })
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_COVERAGE_DROP_15PCT')
  })
})

describe('detectCoverageDelta — silent conditions', () => {
  it('no flag when drop == 5pt (boundary)', () => {
    expect(detectCoverageDelta({ base: summary(80), head: summary(75) })).toHaveLength(0)
  })

  it('no flag for small drop (< 5pt)', () => {
    expect(detectCoverageDelta({ base: summary(80), head: summary(78) })).toHaveLength(0)
  })

  it('no flag when coverage IMPROVES', () => {
    expect(detectCoverageDelta({ base: summary(70), head: summary(85) })).toHaveLength(0)
  })

  it('no flag when base is null', () => {
    expect(detectCoverageDelta({ base: null, head: summary(50) })).toHaveLength(0)
  })

  it('no flag when head is null', () => {
    expect(detectCoverageDelta({ base: summary(80), head: null })).toHaveLength(0)
  })

  it('no flag when both null', () => {
    expect(detectCoverageDelta({ base: null, head: null })).toHaveLength(0)
  })

  it('no flag when a metric is missing (NaN aggregated pct)', () => {
    const broken = {
      total: { lines: { pct: 80 } },
    } as unknown as CoverageSummary
    expect(detectCoverageDelta({ base: broken, head: summary(50) })).toHaveLength(0)
  })
})

describe('detectCoverageDelta — evidence', () => {
  it('evidence includes both base and head pct + drop', () => {
    const out = detectCoverageDelta({ base: summary(80), head: summary(60) })
    expect(out[0].evidence).toContain('80.0%')
    expect(out[0].evidence).toContain('60.0%')
    expect(out[0].evidence).toContain('20.0%pt')
  })

  it('boundary 5.1pt drop fires the 5pct tier', () => {
    const out = detectCoverageDelta({
      base: summary(80),
      head: summary(74.9),
    })
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_COVERAGE_DROP_5PCT')
  })

  it('boundary 15.1pt drop fires the 15pct tier', () => {
    const out = detectCoverageDelta({
      base: summary(80),
      head: summary(64.9),
    })
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_COVERAGE_DROP_15PCT')
  })
})
