import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { computeHarnessRollup, buildHarnessRollupLine } from '@/lib/harness/rollup'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeComponentsBuilder(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
}

function makeAgentEventsSelectBuilder(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
}

function makeInsertBuilder() {
  return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
}

// Minimal component rows for deterministic math checks
function makeComponents(overrides: { weight_pct: number; completion_pct: number }[]) {
  return overrides.map((o, i) => ({
    id: `harness:comp_${i}`,
    display_name: `Component ${i}`,
    weight_pct: o.weight_pct,
    completion_pct: o.completion_pct,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── computeHarnessRollup ──────────────────────────────────────────────────────

describe('computeHarnessRollup', () => {
  it('returns null when harness_components is empty', async () => {
    mockFrom.mockReturnValueOnce(makeComponentsBuilder([]))
    expect(await computeHarnessRollup()).toBeNull()
  })

  it('returns null when DB query errors', async () => {
    const errBuilder = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    }
    mockFrom.mockReturnValueOnce(errBuilder)
    expect(await computeHarnessRollup()).toBeNull()
  })

  it('returns 100 when all components are 100% complete', async () => {
    const rows = makeComponents([
      { weight_pct: 60, completion_pct: 100 },
      { weight_pct: 40, completion_pct: 100 },
    ])
    mockFrom.mockReturnValueOnce(makeComponentsBuilder(rows))
    const result = await computeHarnessRollup()
    expect(result?.rollup_pct).toBe(100)
    expect(result?.complete_count).toBe(2)
    expect(result?.total_count).toBe(2)
    expect(result?.points_remaining).toBe(0)
  })

  it('returns 0 when all components are 0% complete', async () => {
    const rows = makeComponents([
      { weight_pct: 70, completion_pct: 0 },
      { weight_pct: 30, completion_pct: 0 },
    ])
    mockFrom.mockReturnValueOnce(makeComponentsBuilder(rows))
    const result = await computeHarnessRollup()
    expect(result?.rollup_pct).toBe(0)
    expect(result?.complete_count).toBe(0)
    expect(result?.points_remaining).toBe(100)
  })

  it('computes weighted rollup correctly for mixed completion', async () => {
    // 80% weight at 100%, 20% weight at 0% → rollup = 80%
    const rows = makeComponents([
      { weight_pct: 80, completion_pct: 100 },
      { weight_pct: 20, completion_pct: 0 },
    ])
    mockFrom.mockReturnValueOnce(makeComponentsBuilder(rows))
    const result = await computeHarnessRollup()
    expect(result?.rollup_pct).toBe(80)
    expect(result?.complete_count).toBe(1)
    expect(result?.total_count).toBe(2)
    expect(result?.points_remaining).toBe(20)
  })

  it('computes partial completion correctly', async () => {
    // 50% weight at 100%, 50% weight at 50% → rollup = 75%
    const rows = makeComponents([
      { weight_pct: 50, completion_pct: 100 },
      { weight_pct: 50, completion_pct: 50 },
    ])
    mockFrom.mockReturnValueOnce(makeComponentsBuilder(rows))
    const result = await computeHarnessRollup()
    expect(result?.rollup_pct).toBe(75)
    expect(result?.complete_count).toBe(1) // only one is 100%
  })

  it('seeds math: 18 components from 0032 seed give ~84.6%', async () => {
    // Full seed from migration 0032 — regression baseline
    const rows = makeComponents([
      { weight_pct: 18, completion_pct: 100 },
      { weight_pct: 9, completion_pct: 100 },
      { weight_pct: 9, completion_pct: 100 },
      { weight_pct: 9, completion_pct: 100 },
      { weight_pct: 7, completion_pct: 100 },
      { weight_pct: 6, completion_pct: 100 },
      { weight_pct: 5, completion_pct: 100 },
      { weight_pct: 3, completion_pct: 100 },
      { weight_pct: 2, completion_pct: 100 },
      { weight_pct: 5, completion_pct: 100 },
      { weight_pct: 4, completion_pct: 100 },
      { weight_pct: 4, completion_pct: 100 },
      { weight_pct: 4, completion_pct: 0 }, // twin_ollama
      { weight_pct: 2, completion_pct: 100 },
      { weight_pct: 2, completion_pct: 0 }, // telegram_drain_hourly
      { weight_pct: 6, completion_pct: 0 }, // telegram_remaining
      { weight_pct: 3, completion_pct: 30 }, // smoke_test_framework
      { weight_pct: 2, completion_pct: 33 }, // prestaged_tasks
    ])
    mockFrom.mockReturnValueOnce(makeComponentsBuilder(rows))
    const result = await computeHarnessRollup()
    // weighted sum: 83 complete + 0.9 (3×0.3) + 0.66 (2×0.33) = 84.56 → 84.6
    expect(result?.rollup_pct).toBe(84.6)
    expect(result?.complete_count).toBe(13) // 13 components at 100%
    expect(result?.total_count).toBe(18)
  })
})

// ── buildHarnessRollupLine ────────────────────────────────────────────────────

describe('buildHarnessRollupLine', () => {
  function makeFullSlots(componentRows: unknown[], priorEventRows: unknown[]) {
    // Slot 1: harness_components select
    mockFrom.mockReturnValueOnce(makeComponentsBuilder(componentRows))
    // Slot 2: agent_events delta query (createServiceClient called again in buildHarnessRollupLine)
    mockFrom.mockReturnValueOnce(makeAgentEventsSelectBuilder(priorEventRows))
    // Slot 3: agent_events insert (F18 log)
    mockFrom.mockReturnValueOnce(makeInsertBuilder())
  }

  it('returns fallback when computeHarnessRollup returns null (empty table)', async () => {
    mockFrom.mockReturnValueOnce(makeComponentsBuilder([]))
    const line = await buildHarnessRollupLine()
    expect(line).toBe('Harness rollup: no harness_components rows')
  })

  it('returns base line with no delta when no prior event exists', async () => {
    const rows = makeComponents([
      { weight_pct: 80, completion_pct: 100 },
      { weight_pct: 20, completion_pct: 0 },
    ])
    makeFullSlots(rows, [])
    const line = await buildHarnessRollupLine()
    expect(line).toBe('Harness rollup: 80.0% (1/2 components complete)')
  })

  it('shows positive delta when rollup improved from yesterday', async () => {
    const rows = makeComponents([
      { weight_pct: 80, completion_pct: 100 },
      { weight_pct: 20, completion_pct: 0 },
    ])
    makeFullSlots(rows, [{ meta: { rollup_pct: 75.0 } }])
    const line = await buildHarnessRollupLine()
    expect(line).toContain('Harness rollup: 80.0%')
    expect(line).toContain('Δ +5.0% from yesterday')
  })

  it('shows negative delta when rollup declined', async () => {
    const rows = makeComponents([
      { weight_pct: 80, completion_pct: 100 },
      { weight_pct: 20, completion_pct: 0 },
    ])
    makeFullSlots(rows, [{ meta: { rollup_pct: 85.0 } }])
    const line = await buildHarnessRollupLine()
    expect(line).toContain('Δ -5.0% from yesterday')
  })

  it('shows 0.0 delta when rollup unchanged', async () => {
    const rows = makeComponents([
      { weight_pct: 80, completion_pct: 100 },
      { weight_pct: 20, completion_pct: 0 },
    ])
    makeFullSlots(rows, [{ meta: { rollup_pct: 80.0 } }])
    const line = await buildHarnessRollupLine()
    expect(line).toContain('Δ +0.0% from yesterday')
  })

  it('all complete → 100.0% line', async () => {
    const rows = makeComponents([
      { weight_pct: 60, completion_pct: 100 },
      { weight_pct: 40, completion_pct: 100 },
    ])
    makeFullSlots(rows, [])
    const line = await buildHarnessRollupLine()
    expect(line).toContain('100.0%')
    expect(line).toContain('2/2 components complete')
  })

  it('returns unavailable on unexpected error', async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error('unexpected')
    })
    const line = await buildHarnessRollupLine()
    expect(line).toBe('Harness rollup: unavailable')
  })

  it('logs harness_rollup_computed event with rollup_pct', async () => {
    const rows = makeComponents([
      { weight_pct: 80, completion_pct: 100 },
      { weight_pct: 20, completion_pct: 0 },
    ])
    // Slot 1: components | Slot 2: delta query | Slot 3: insert (capture it)
    mockFrom.mockReturnValueOnce(makeComponentsBuilder(rows))
    mockFrom.mockReturnValueOnce(makeAgentEventsSelectBuilder([]))
    const ib = makeInsertBuilder()
    mockFrom.mockReturnValueOnce(ib)

    await buildHarnessRollupLine()

    expect(ib.insert).toHaveBeenCalledTimes(1)
    const row = ib.insert.mock.calls[0][0]
    expect(row.action).toBe('harness_rollup_computed')
    expect(row.domain).toBe('harness')
    expect(row.status).toBe('success')
    expect(row.meta.rollup_pct).toBe(80)
  })
})
