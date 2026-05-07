/**
 * F18 retrofit tests for the amazon module.
 *
 * Demonstrates the F18 retrofit pattern shipped in this PR:
 *   capture → agent_events 'amazon.viewed' on every page render
 *   benchmark → BENCHMARK_30D_REVENUE_CAD in lib/amazon/benchmark.ts
 *   surface → AmazonPaceBadge widget at the top of AmazonReportsPage
 *
 * The page widget is React; we don't render it here. We test the pure pace
 * computation + benchmark constant shape — the parts the surfacing widget
 * + agent_events log both consume.
 */

import { describe, expect, it } from 'vitest'
import { BENCHMARK_30D_REVENUE_CAD, computeAmazonPace } from '@/lib/amazon/benchmark'

describe('BENCHMARK_30D_REVENUE_CAD', () => {
  it('is a positive number', () => {
    expect(BENCHMARK_30D_REVENUE_CAD).toBeGreaterThan(0)
  })

  it('is reasonable for an Amazon FBA business (between $1k and $5M per 30d)', () => {
    expect(BENCHMARK_30D_REVENUE_CAD).toBeGreaterThanOrEqual(1_000)
    expect(BENCHMARK_30D_REVENUE_CAD).toBeLessThanOrEqual(5_000_000)
  })
})

describe('computeAmazonPace — basic status thresholds', () => {
  it('returns "on_pace" when 30d revenue exactly matches target', () => {
    const result = computeAmazonPace(BENCHMARK_30D_REVENUE_CAD)
    expect(result.targetCad).toBe(BENCHMARK_30D_REVENUE_CAD)
    expect(result.expectedCad).toBe(BENCHMARK_30D_REVENUE_CAD)
    expect(result.pacePct).toBe(100)
    expect(result.status).toBe('on_pace')
  })

  it('returns "ahead" when 30d revenue is ≥110% of target', () => {
    const result = computeAmazonPace(BENCHMARK_30D_REVENUE_CAD * 1.15)
    expect(result.pacePct).toBe(115)
    expect(result.status).toBe('ahead')
  })

  it('returns "behind" when 30d revenue is < 90% of target', () => {
    const result = computeAmazonPace(BENCHMARK_30D_REVENUE_CAD * 0.5)
    expect(result.pacePct).toBe(50)
    expect(result.status).toBe('behind')
  })

  it('"on_pace" lower boundary at exactly 90%', () => {
    const result = computeAmazonPace(BENCHMARK_30D_REVENUE_CAD * 0.9)
    expect(result.pacePct).toBe(90)
    expect(result.status).toBe('on_pace')
  })

  it('"ahead" boundary at exactly 110%', () => {
    const result = computeAmazonPace(BENCHMARK_30D_REVENUE_CAD * 1.1)
    expect(result.pacePct).toBe(110)
    expect(result.status).toBe('ahead')
  })

  it('"behind" upper boundary at 89% (just under on_pace cutoff)', () => {
    const result = computeAmazonPace(BENCHMARK_30D_REVENUE_CAD * 0.89)
    expect(result.pacePct).toBe(89)
    expect(result.status).toBe('behind')
  })
})

describe('computeAmazonPace — edge cases', () => {
  it('returns 100% on_pace when target is 0 (degenerate, no expectation)', () => {
    const result = computeAmazonPace(0, 0)
    expect(result.expectedCad).toBe(0)
    expect(result.pacePct).toBe(100)
    expect(result.status).toBe('on_pace')
  })

  it('returns "behind" with 0% pace when revenue is 0 against a positive target', () => {
    const result = computeAmazonPace(0)
    expect(result.pacePct).toBe(0)
    expect(result.status).toBe('behind')
  })
})

describe('computeAmazonPace — overridable target', () => {
  it('respects an explicit targetCad override', () => {
    const customTarget = 50_000
    const result = computeAmazonPace(customTarget * 1.2, customTarget)
    expect(result.targetCad).toBe(customTarget)
    expect(result.expectedCad).toBe(customTarget)
    expect(result.pacePct).toBe(120)
    expect(result.status).toBe('ahead')
  })

  it('uses default benchmark when no override passed', () => {
    const result = computeAmazonPace(BENCHMARK_30D_REVENUE_CAD)
    expect(result.targetCad).toBe(BENCHMARK_30D_REVENUE_CAD)
  })
})

describe('computeAmazonPace — result shape', () => {
  it('always returns all four fields with correct types', () => {
    const result = computeAmazonPace(BENCHMARK_30D_REVENUE_CAD * 0.95)
    expect(typeof result.targetCad).toBe('number')
    expect(typeof result.expectedCad).toBe('number')
    expect(typeof result.pacePct).toBe('number')
    expect(['ahead', 'on_pace', 'behind']).toContain(result.status)
  })
})
