/**
 * Tests for lib/harness/autonomy-rollup.ts (F-L10).
 *
 * Covers:
 *   - 0 total completed → "no tasks completed" message
 *   - 100% autonomous (handoff-file + cron only) → ✅
 *   - 0% autonomous (manual + colin-telegram only) → ❌ + suggestion
 *   - Mixed sources at threshold boundaries (60%, 30%)
 *   - DB error → fallback string (never throws)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { buildAutonomyRollupLine } from '@/lib/harness/autonomy-rollup'

type QueryResult = { data: unknown; error: null | { message: string } }

function makeQueryChain(result: QueryResult) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'lte', 'lt', 'limit', 'order']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) =>
    Promise.resolve(result).then(fn)
  return chain
}

function wireSources(rows: Array<{ source: string }>) {
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'task_queue') return makeQueryChain({ data: [], error: null })
    return makeQueryChain({ data: rows, error: null })
  })
}

describe('buildAutonomyRollupLine — empty window', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns "no tasks completed" when 0 rows', async () => {
    wireSources([])
    const result = await buildAutonomyRollupLine()
    expect(result).toBe('Autonomy (7d): no tasks completed')
  })
})

describe('buildAutonomyRollupLine — 100% autonomous', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows 100% ✅ when only handoff-file + cron sources', async () => {
    wireSources([
      { source: 'handoff-file' },
      { source: 'handoff-file' },
      { source: 'cron' },
      { source: 'cron' },
    ])
    const result = await buildAutonomyRollupLine()
    expect(result).toContain('Autonomy (7d): 100%')
    expect(result).toContain('(4 autonomous / 4 total)')
    expect(result).toContain('✅')
    expect(result).not.toContain('💡')
  })
})

describe('buildAutonomyRollupLine — 0% autonomous', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows 0% ❌ + suggestion when only manual + colin-telegram', async () => {
    wireSources([
      { source: 'manual' },
      { source: 'colin-telegram' },
      { source: 'manual' },
    ])
    const result = await buildAutonomyRollupLine()
    expect(result).toContain('Autonomy (7d): 0%')
    expect(result).toContain('(0 autonomous / 3 total)')
    expect(result).toContain('❌')
    expect(result).toContain('💡')
    expect(result).toContain('pickup cron')
  })
})

describe('buildAutonomyRollupLine — mixed thresholds', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows ✅ at 60% boundary', async () => {
    // 3/5 = 60% → ✅
    wireSources([
      { source: 'cron' },
      { source: 'cron' },
      { source: 'handoff-file' },
      { source: 'manual' },
      { source: 'manual' },
    ])
    const result = await buildAutonomyRollupLine()
    expect(result).toContain('Autonomy (7d): 60%')
    expect(result).toContain('✅')
  })

  it('shows ⚠️ between 30% and 59%', async () => {
    // 2/5 = 40% → ⚠️
    wireSources([
      { source: 'cron' },
      { source: 'handoff-file' },
      { source: 'manual' },
      { source: 'manual' },
      { source: 'colin-telegram' },
    ])
    const result = await buildAutonomyRollupLine()
    expect(result).toContain('Autonomy (7d): 40%')
    expect(result).toContain('⚠️')
    expect(result).not.toContain('💡')
  })

  it('shows ⚠️ at the 30% boundary (no suggestion)', async () => {
    // 3/10 = 30% → ⚠️
    wireSources([
      { source: 'cron' },
      { source: 'cron' },
      { source: 'handoff-file' },
      { source: 'manual' },
      { source: 'manual' },
      { source: 'manual' },
      { source: 'manual' },
      { source: 'manual' },
      { source: 'colin-telegram' },
      { source: 'colin-telegram' },
    ])
    const result = await buildAutonomyRollupLine()
    expect(result).toContain('Autonomy (7d): 30%')
    expect(result).toContain('⚠️')
    expect(result).not.toContain('💡')
  })

  it('shows ❌ + suggestion just below 30%', async () => {
    // 2/10 = 20% → ❌ + 💡
    wireSources([
      { source: 'cron' },
      { source: 'handoff-file' },
      ...Array.from({ length: 8 }, () => ({ source: 'manual' })),
    ])
    const result = await buildAutonomyRollupLine()
    expect(result).toContain('Autonomy (7d): 20%')
    expect(result).toContain('❌')
    expect(result).toContain('💡')
  })
})

describe('buildAutonomyRollupLine — DB error (never throws)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns fallback when client throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('connection refused')
    })
    const result = await buildAutonomyRollupLine()
    expect(result).toBe('Autonomy: stats unavailable')
  })

  it('returns fallback when query rejects', async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockRejectedValue(new Error('db error')),
      limit: vi.fn().mockReturnThis(),
    }))
    const result = await buildAutonomyRollupLine()
    expect(result).toBe('Autonomy: stats unavailable')
  })
})
