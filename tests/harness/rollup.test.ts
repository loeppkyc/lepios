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

  it('seeds math: 21 components from 0043 seed give 55.7%', async () => {
    // Full seed from migration 0043 — regression baseline.
    // Source of truth: docs/harness/HARNESS_FOUNDATION_SPEC.md (Draft 2, 2026-04-28).
    const rows = makeComponents([
      // T1 — Core orchestration (24 weight, all shipped)
      { weight_pct: 12, completion_pct: 100 }, // coordinator_loop
      { weight_pct: 5, completion_pct: 100 }, // task_pickup
      { weight_pct: 4, completion_pct: 100 }, // remote_invocation
      { weight_pct: 3, completion_pct: 100 }, // deploy_gate
      // T2 — Observability + improvement (16 weight)
      { weight_pct: 3, completion_pct: 100 }, // stall_detection
      { weight_pct: 3, completion_pct: 100 }, // notification_drain
      { weight_pct: 3, completion_pct: 100 }, // f18_surfacing
      { weight_pct: 4, completion_pct: 100 }, // improvement_loop
      { weight_pct: 3, completion_pct: 90 }, // smoke_test_framework
      // T3 — Agentic capabilities (45 weight)
      { weight_pct: 9, completion_pct: 30 }, // arms_legs
      { weight_pct: 7, completion_pct: 0 }, // sandbox
      { weight_pct: 7, completion_pct: 30 }, // security_layer
      { weight_pct: 6, completion_pct: 0 }, // self_repair
      { weight_pct: 6, completion_pct: 85 }, // digital_twin
      { weight_pct: 5, completion_pct: 40 }, // specialized_agents
      { weight_pct: 3, completion_pct: 0 }, // push_bash_automation
      { weight_pct: 2, completion_pct: 10 }, // debate_consensus
      // T4 — Interfaces + attribution (15 weight)
      { weight_pct: 6, completion_pct: 0 }, // chat_ui
      { weight_pct: 4, completion_pct: 50 }, // telegram_outbound
      { weight_pct: 3, completion_pct: 30 }, // attribution
      { weight_pct: 2, completion_pct: 50 }, // ollama_daytime
    ])
    mockFrom.mockReturnValueOnce(makeComponentsBuilder(rows))
    const result = await computeHarnessRollup()
    // T1=24.0 + T2=15.7 + T3=12.1 + T4=3.9 = 55.7
    expect(result?.rollup_pct).toBe(55.7)
    expect(result?.complete_count).toBe(8) // 8 components at 100%
    expect(result?.total_count).toBe(21)
    // Sum of weights = 100, so points_remaining = 100 - 55.7 = 44.3
    expect(result?.points_remaining).toBe(44.3)
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
