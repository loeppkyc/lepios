import { describe, it, expect } from 'vitest'
import { scoreNightTick } from '@/lib/orchestrator/scoring'
import type { TickResult, HistoricalContext } from '@/lib/orchestrator/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCheck(name: string, status: 'pass' | 'warn' | 'fail', flagCount = 0) {
  return {
    name,
    status,
    flags: Array.from({ length: flagCount }, (_, i) => ({
      severity: 'warn' as const,
      message: `flag ${i}`,
    })),
    counts: {},
    duration_ms: 10,
  }
}

function makeTickResult(overrides: Partial<TickResult> = {}): TickResult {
  return {
    tick_id: 'tick-aaaa',
    run_id: 'run-bbbb',
    mode: 'overnight_readonly',
    started_at: '2026-04-20T08:00:00.000Z',
    finished_at: '2026-04-20T08:00:01.000Z',
    duration_ms: 1000,
    status: 'completed',
    checks: [
      makeCheck('site_health', 'pass'),
      makeCheck('scan_integrity', 'pass'),
      makeCheck('event_log_consistency', 'pass'),
    ],
    ...overrides,
  }
}

function makeHistory(durations: number[]): HistoricalContext {
  return { task_type: 'night_tick', capacity_tier: 'tier_1_laptop_ollama', prior_durations_ms: durations }
}

// 10 evenly-spaced values: p20=280, p50=550, p80=820, 2×median=1100, 5×median=2750
const TEN_DURATIONS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]

// ── Completeness ──────────────────────────────────────────────────────────────

describe('scoreNightTick — completeness', () => {
  it('all pass → 100', () => {
    const result = scoreNightTick(makeTickResult(), makeHistory([]))
    expect(result.dimensions.completeness).toBe(100)
  })

  it('one warn → weighted correctly (93.3…)', () => {
    const tick = makeTickResult({
      checks: [makeCheck('a', 'pass'), makeCheck('b', 'pass'), makeCheck('c', 'warn')],
    })
    // (100 + 100 + 80) / 3 = 93.333…
    const v = scoreNightTick(tick, makeHistory([])).dimensions.completeness
    expect(Math.abs(v - 93.33)).toBeLessThan(0.1)
  })

  it('one fail → 66.7 (2/3 pass, 1/3 fail)', () => {
    const tick = makeTickResult({
      checks: [makeCheck('a', 'pass'), makeCheck('b', 'pass'), makeCheck('c', 'fail')],
    })
    const v = scoreNightTick(tick, makeHistory([])).dimensions.completeness
    expect(Math.abs(v - 66.67)).toBeLessThan(0.1)
  })
})

// ── Signal quality ────────────────────────────────────────────────────────────

describe('scoreNightTick — signal_quality', () => {
  it('zero flags → 50', () => {
    const result = scoreNightTick(makeTickResult(), makeHistory([]))
    expect(result.dimensions.signal_quality).toBe(50)
  })

  it('one flag → 70', () => {
    const tick = makeTickResult({
      checks: [makeCheck('site_health', 'warn', 1), makeCheck('scan_integrity', 'pass'), makeCheck('event_log_consistency', 'pass')],
    })
    expect(scoreNightTick(tick, makeHistory([])).dimensions.signal_quality).toBe(70)
  })
})

// ── Efficiency ────────────────────────────────────────────────────────────────

describe('scoreNightTick — efficiency', () => {
  it('below baseline threshold (< 7 runs) → defaults to 50', () => {
    const result = scoreNightTick(makeTickResult(), makeHistory([100, 200, 300]))
    expect(result.dimensions.efficiency).toBe(50)
  })

  it('empty history → defaults to 50', () => {
    const result = scoreNightTick(makeTickResult(), makeHistory([]))
    expect(result.dimensions.efficiency).toBe(50)
  })

  it('duration at p20 → 100', () => {
    // p20 of TEN_DURATIONS = index 1.8 → lerp(200,300,0.8) = 280
    const tick = makeTickResult({ duration_ms: 280 })
    expect(scoreNightTick(tick, makeHistory(TEN_DURATIONS)).dimensions.efficiency).toBe(100)
  })

  it('duration at median (p50) → 75', () => {
    // p50 of TEN_DURATIONS = index 4.5 → lerp(500,600,0.5) = 550
    const tick = makeTickResult({ duration_ms: 550 })
    expect(scoreNightTick(tick, makeHistory(TEN_DURATIONS)).dimensions.efficiency).toBe(75)
  })

  it('duration at 5× median → 0 (floor)', () => {
    // 5 × 550 = 2750
    const tick = makeTickResult({ duration_ms: 2750 })
    expect(scoreNightTick(tick, makeHistory(TEN_DURATIONS)).dimensions.efficiency).toBe(0)
  })

  it('duration beyond 5× median → 0 (clamped)', () => {
    const tick = makeTickResult({ duration_ms: 99999 })
    expect(scoreNightTick(tick, makeHistory(TEN_DURATIONS)).dimensions.efficiency).toBe(0)
  })
})

// ── Hygiene ───────────────────────────────────────────────────────────────────

describe('scoreNightTick — hygiene', () => {
  it('all required fields present → 100', () => {
    expect(scoreNightTick(makeTickResult(), makeHistory([])).dimensions.hygiene).toBe(100)
  })

  it('one required field missing → 80', () => {
    const tick = makeTickResult({ tick_id: undefined as unknown as string })
    expect(scoreNightTick(tick, makeHistory([])).dimensions.hygiene).toBe(80)
  })
})

// ── Aggregate ─────────────────────────────────────────────────────────────────

describe('scoreNightTick — aggregate', () => {
  it('known inputs produce correct weighted aggregate', () => {
    // all-pass → completeness=100, 0 flags → signal=50, below baseline → efficiency=50, all fields → hygiene=100
    // 100×0.4 + 50×0.3 + 50×0.2 + 100×0.1 = 40+15+10+10 = 75.0
    const result = scoreNightTick(makeTickResult(), makeHistory([]))
    expect(result.aggregate).toBe(75.0)
  })
})

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('scoreNightTick — metadata', () => {
  it('scored_at is ISO 8601 timestamp', () => {
    const { scored_at } = scoreNightTick(makeTickResult(), makeHistory([]))
    expect(scored_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('scored_by is rule_based_v1', () => {
    expect(scoreNightTick(makeTickResult(), makeHistory([])).scored_by).toBe('rule_based_v1')
  })

  it('capacity_tier is tier_1_laptop_ollama', () => {
    expect(scoreNightTick(makeTickResult(), makeHistory([])).capacity_tier).toBe('tier_1_laptop_ollama')
  })

  it('weights_version is v1', () => {
    expect(scoreNightTick(makeTickResult(), makeHistory([])).weights_version).toBe('v1')
  })
})
