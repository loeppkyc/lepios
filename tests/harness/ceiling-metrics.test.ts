/**
 * Tests for lib/harness/ceiling-metrics.ts
 *
 * Covers:
 *   (a) flat trend detection — std dev of last 3 deltas < 2.0 → ceiling flagged
 *   (b) declining trend detection — all 3 most recent deltas negative → ceiling flagged
 *   (c) insufficient data (< 5 rows) → "none detected"
 *   (d) unknown (component, metric) falls back to generic cause string
 *   (e) improving trend → not flagged
 *   (f) DB error → never throws, returns fallback string
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeTrend } from '@/lib/harness/ceiling-metrics'
import type { ImprovementRow } from '@/lib/harness/ceiling-metrics'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { buildCeilingMetricLines } from '@/lib/harness/ceiling-metrics'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(
  component: string,
  metric: string,
  value: number,
  recorded_at: string,
  unit = 'pct'
): ImprovementRow {
  return { component, metric, unit, value, recorded_at }
}

/** Creates 5 rows for the given values, 1 hour apart starting at T0. */
function makeRows5(
  component: string,
  metric: string,
  values: [number, number, number, number, number],
  unit = 'pct'
): ImprovementRow[] {
  const base = new Date('2026-05-01T00:00:00Z')
  return values.map((v, i) => {
    const ts = new Date(base.getTime() + i * 3_600_000).toISOString()
    return makeRow(component, metric, v, ts, unit)
  })
}

type QueryResult = { data: unknown; error: null | { message: string } }

function makeQueryChain(result: QueryResult) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'lte', 'not', 'or', 'order', 'limit', 'filter']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

// ── computeTrend unit tests ───────────────────────────────────────────────────

describe('computeTrend — unit', () => {
  it('returns insufficient_data when fewer than 5 rows', () => {
    const rows = makeRows5('c', 'm', [10, 12, 14, 16, 18]).slice(0, 4)
    expect(computeTrend(rows)).toBe('insufficient_data')
  })

  it('returns declining when all 3 most recent deltas are negative', () => {
    // values: 10 → 12 → 14 → 13 → 12 → 11
    // deltas:    +2   +2   -1   -1   -1
    // last 3 deltas: -1, -1, -1 → all negative
    const rows: ImprovementRow[] = [
      makeRow('c', 'm', 10, '2026-05-01T00:00:00Z'),
      makeRow('c', 'm', 12, '2026-05-01T01:00:00Z'),
      makeRow('c', 'm', 14, '2026-05-01T02:00:00Z'),
      makeRow('c', 'm', 13, '2026-05-01T03:00:00Z'),
      makeRow('c', 'm', 12, '2026-05-01T04:00:00Z'),
      makeRow('c', 'm', 11, '2026-05-01T05:00:00Z'),
    ]
    expect(computeTrend(rows)).toBe('declining')
  })

  it('returns flat when std dev of last 3 deltas is < 2.0', () => {
    // values: 10 → 12 → 14 → 14.1 → 14.0 → 13.9
    // deltas: +2, +2, +0.1, -0.1, -0.1
    // last 3 deltas: +0.1, -0.1, -0.1 — mean = -0.033, variance ≈ 0.0089, stdDev ≈ 0.094 < 2
    const rows: ImprovementRow[] = [
      makeRow('c', 'm', 10, '2026-05-01T00:00:00Z'),
      makeRow('c', 'm', 12, '2026-05-01T01:00:00Z'),
      makeRow('c', 'm', 14, '2026-05-01T02:00:00Z'),
      makeRow('c', 'm', 14.1, '2026-05-01T03:00:00Z'),
      makeRow('c', 'm', 14.0, '2026-05-01T04:00:00Z'),
      makeRow('c', 'm', 13.9, '2026-05-01T05:00:00Z'),
    ]
    expect(computeTrend(rows)).toBe('flat')
  })

  it('returns improving when deltas are large and positive', () => {
    // values: 10, 13, 17, 22, 28 — deltas: +3, +4, +5, +6
    // last 3 deltas: +4, +5, +6 — std dev ≈ 0.82 < 2 BUT they are all positive
    // Check: declining needs all negative → no. Flat check: stdDev of [4,5,6] = sqrt(2/3) ≈ 0.82 < 2
    // → This would be "flat" by the algorithm since deltas are all tiny relative to each other.
    // Use a case with high std dev to confirm "improving"
    const rows: ImprovementRow[] = [
      makeRow('c', 'm', 10, '2026-05-01T00:00:00Z'),
      makeRow('c', 'm', 15, '2026-05-01T01:00:00Z'),
      makeRow('c', 'm', 30, '2026-05-01T02:00:00Z'),
      makeRow('c', 'm', 60, '2026-05-01T03:00:00Z'),
      makeRow('c', 'm', 100, '2026-05-01T04:00:00Z'),
    ]
    // deltas: 5, 15, 30, 40 — last 3: 15, 30, 40
    // mean=28.33, variance=101.55, stdDev≈10.08 ≥ 2 and not all negative → improving
    expect(computeTrend(rows)).toBe('improving')
  })
})

// ── buildCeilingMetricLines integration tests ─────────────────────────────────

describe('buildCeilingMetricLines — no ceilings detected', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns "none detected" when DB has no rows', async () => {
    mockFrom.mockReturnValue(makeQueryChain({ data: [], error: null }))
    const result = await buildCeilingMetricLines()
    expect(result).toBe('Improvement ceilings: none detected')
  })

  it('returns "none detected" when fewer than 5 rows exist for each component', async () => {
    // Only 3 rows for arb-engine:match_rate_pct — insufficient data
    const rows = [
      makeRow('arb-engine', 'match_rate_pct', 10, '2026-05-01T00:00:00Z'),
      makeRow('arb-engine', 'match_rate_pct', 12, '2026-05-01T01:00:00Z'),
      makeRow('arb-engine', 'match_rate_pct', 14, '2026-05-01T02:00:00Z'),
    ]
    mockFrom.mockReturnValue(makeQueryChain({ data: rows, error: null }))
    const result = await buildCeilingMetricLines()
    expect(result).toBe('Improvement ceilings: none detected')
  })
})

describe('buildCeilingMetricLines — flat trend', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flags a known (component, metric) with the correct heuristic cause', async () => {
    // 5 rows for arb-engine:match_rate_pct with flat deltas
    const rows: ImprovementRow[] = [
      makeRow('arb-engine', 'match_rate_pct', 10, '2026-05-01T00:00:00Z'),
      makeRow('arb-engine', 'match_rate_pct', 12, '2026-05-01T01:00:00Z'),
      makeRow('arb-engine', 'match_rate_pct', 12.1, '2026-05-01T02:00:00Z'),
      makeRow('arb-engine', 'match_rate_pct', 12.0, '2026-05-01T03:00:00Z'),
      makeRow('arb-engine', 'match_rate_pct', 11.9, '2026-05-01T04:00:00Z'),
    ]
    mockFrom.mockReturnValue(makeQueryChain({ data: rows, error: null }))
    const result = await buildCeilingMetricLines()
    expect(result).toContain('arb-engine: ceiling at match_rate_pct=11.9pct')
    expect(result).toContain('Keepa token budget limits scan breadth')
    expect(result).toContain('Keepa tokens ~$5–20/mo')
  })
})

describe('buildCeilingMetricLines — declining trend', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flags a declining component with cause and lift cost', async () => {
    const rows: ImprovementRow[] = [
      makeRow('arb-engine', 'buy_rate_pct', 15, '2026-05-01T00:00:00Z'),
      makeRow('arb-engine', 'buy_rate_pct', 14, '2026-05-01T01:00:00Z'),
      makeRow('arb-engine', 'buy_rate_pct', 13, '2026-05-01T02:00:00Z'),
      makeRow('arb-engine', 'buy_rate_pct', 12, '2026-05-01T03:00:00Z'),
      makeRow('arb-engine', 'buy_rate_pct', 11, '2026-05-01T04:00:00Z'),
    ]
    // deltas: -1, -1, -1, -1 — last 3: all negative → declining
    mockFrom.mockReturnValue(makeQueryChain({ data: rows, error: null }))
    const result = await buildCeilingMetricLines()
    expect(result).toContain('arb-engine: ceiling at buy_rate_pct=11pct')
    expect(result).toContain('Buy decisions limited by price rule precision')
  })
})

describe('buildCeilingMetricLines — unknown component fallback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses generic cause when no heuristic entry exists for the pair', async () => {
    // Use a component not in CEILING_HEURISTICS
    const rows: ImprovementRow[] = [
      makeRow('new-module', 'accuracy_pct', 80, '2026-05-01T00:00:00Z'),
      makeRow('new-module', 'accuracy_pct', 81, '2026-05-01T01:00:00Z'),
      makeRow('new-module', 'accuracy_pct', 81.1, '2026-05-01T02:00:00Z'),
      makeRow('new-module', 'accuracy_pct', 81.0, '2026-05-01T03:00:00Z'),
      makeRow('new-module', 'accuracy_pct', 80.9, '2026-05-01T04:00:00Z'),
    ]
    mockFrom.mockReturnValue(makeQueryChain({ data: rows, error: null }))
    const result = await buildCeilingMetricLines()
    expect(result).toContain('new-module: ceiling at accuracy_pct=80.9pct')
    expect(result).toContain('No heuristic defined — add entry to CEILING_HEURISTICS')
    expect(result).toContain('lift: unknown')
  })
})

describe('buildCeilingMetricLines — DB error', () => {
  beforeEach(() => vi.clearAllMocks())

  it('never throws — returns fallback string when DB throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('connection refused')
    })
    const result = await buildCeilingMetricLines()
    expect(result).toBe('Improvement ceilings: stats unavailable')
  })

  it('returns fallback string when DB returns error', async () => {
    mockFrom.mockReturnValue(makeQueryChain({ data: null, error: { message: 'db error' } }))
    const result = await buildCeilingMetricLines()
    expect(result).toBe('Improvement ceilings: stats unavailable')
  })
})
