/**
 * F18 retrofit tests for the payouts module.
 *
 * Demonstrates the F18 retrofit pattern shipped in this PR:
 *   capture → agent_events 'payouts.viewed' on every API fetch
 *   benchmark → BENCHMARK_MONTHLY_NET_CAD in lib/payouts/benchmark.ts
 *   surface → PaceBadge widget at the top of PayoutsPage
 *
 * The page widget is React; we don't render it here. We test the pure pace
 * computation + benchmark constant shape — the parts the surfacing widget
 * + agent_events log both consume.
 */

import { describe, expect, it } from 'vitest'
import { BENCHMARK_MONTHLY_NET_CAD, computePace } from '@/lib/payouts/benchmark'

describe('BENCHMARK_MONTHLY_NET_CAD', () => {
  it('is a positive number', () => {
    expect(BENCHMARK_MONTHLY_NET_CAD).toBeGreaterThan(0)
  })

  it('is reasonable for an Amazon FBA business (between $1k and $1M monthly net)', () => {
    expect(BENCHMARK_MONTHLY_NET_CAD).toBeGreaterThanOrEqual(1_000)
    expect(BENCHMARK_MONTHLY_NET_CAD).toBeLessThanOrEqual(1_000_000)
  })
})

describe('computePace — current year', () => {
  // Pin "now" at end of June so we have 6 months elapsed.
  const NOW = new Date('2026-06-30T23:59:59Z')

  it('returns "on_pace" when YTD matches expected (within ±10%)', () => {
    const expected = BENCHMARK_MONTHLY_NET_CAD * 6
    const result = computePace(expected, 2026, NOW)
    expect(result.monthlyTargetCad).toBe(BENCHMARK_MONTHLY_NET_CAD)
    expect(result.expectedYtdCad).toBe(expected)
    expect(result.ytdPacePct).toBe(100)
    expect(result.status).toBe('on_pace')
  })

  it('returns "ahead" when YTD is ≥110% of expected', () => {
    const expected = BENCHMARK_MONTHLY_NET_CAD * 6
    const result = computePace(expected * 1.15, 2026, NOW)
    expect(result.ytdPacePct).toBe(115)
    expect(result.status).toBe('ahead')
  })

  it('returns "behind" when YTD is < 90% of expected', () => {
    const expected = BENCHMARK_MONTHLY_NET_CAD * 6
    const result = computePace(expected * 0.5, 2026, NOW)
    expect(result.ytdPacePct).toBe(50)
    expect(result.status).toBe('behind')
  })

  it('"on_pace" boundary at exactly 90%', () => {
    const expected = BENCHMARK_MONTHLY_NET_CAD * 6
    const result = computePace(expected * 0.9, 2026, NOW)
    expect(result.ytdPacePct).toBe(90)
    expect(result.status).toBe('on_pace')
  })

  it('"ahead" boundary at exactly 110%', () => {
    const expected = BENCHMARK_MONTHLY_NET_CAD * 6
    const result = computePace(expected * 1.1, 2026, NOW)
    expect(result.ytdPacePct).toBe(110)
    expect(result.status).toBe('ahead')
  })
})

describe('computePace — past year (full 12-month accountability)', () => {
  const NOW = new Date('2026-06-30T23:59:59Z')

  it('uses 12 months for past years, regardless of current month', () => {
    const result = computePace(BENCHMARK_MONTHLY_NET_CAD * 12, 2025, NOW)
    expect(result.expectedYtdCad).toBe(BENCHMARK_MONTHLY_NET_CAD * 12)
    expect(result.ytdPacePct).toBe(100)
    expect(result.status).toBe('on_pace')
  })

  it('flags "behind" when past year missed annual target', () => {
    const result = computePace(BENCHMARK_MONTHLY_NET_CAD * 6, 2025, NOW)
    expect(result.ytdPacePct).toBe(50)
    expect(result.status).toBe('behind')
  })
})

describe('computePace — future year (no expectation yet)', () => {
  const NOW = new Date('2026-06-30T23:59:59Z')

  it('returns 100% on_pace for a future year (zero expected)', () => {
    const result = computePace(0, 2027, NOW)
    expect(result.expectedYtdCad).toBe(0)
    expect(result.ytdPacePct).toBe(100)
    expect(result.status).toBe('on_pace')
  })
})

describe('computePace — January edge case', () => {
  const NOW = new Date('2026-01-15T12:00:00Z')

  it('expected = 1 month target in January', () => {
    const result = computePace(BENCHMARK_MONTHLY_NET_CAD, 2026, NOW)
    expect(result.expectedYtdCad).toBe(BENCHMARK_MONTHLY_NET_CAD)
    expect(result.ytdPacePct).toBe(100)
  })
})

describe('computePace — overridable monthly target', () => {
  const NOW = new Date('2026-06-30T23:59:59Z')

  it('respects an explicit monthlyTargetCad override', () => {
    const customTarget = 25_000
    const result = computePace(customTarget * 6, 2026, NOW, customTarget)
    expect(result.monthlyTargetCad).toBe(customTarget)
    expect(result.expectedYtdCad).toBe(customTarget * 6)
    expect(result.ytdPacePct).toBe(100)
  })
})
