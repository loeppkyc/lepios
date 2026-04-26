/**
 * Tests for lib/harness/quota-cliff.ts
 *
 * Covers:
 *   - 0 events / 0 stuck → clean line ✅
 *   - N×429 events, 0 stuck → warning line ⚠️
 *   - N×429 events, M stuck tasks → error line ❌ with action hint
 *   - 0 events, M stuck tasks → error line ❌ (stuck tasks always trigger error)
 *   - Singular "task" vs plural "tasks" in stuck count
 *   - DB error → fallback string, never throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { buildQuotaCliffLine } from '@/lib/harness/quota-cliff'

// ── Chain builder ─────────────────────────────────────────────────────────────

type QueryResult = { data: unknown[] | null; error: null }

function makeQueryChain(result: QueryResult) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'filter', 'gte', 'lt', 'lte', 'not', 'or', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

// ── Slot helper ───────────────────────────────────────────────────────────────
// quota-cliff queries agent_events (429 errors) and task_queue (stuck-claimed).
// Differentiate by table name — order-independent.

interface Slots {
  errors: unknown[]
  stuck: unknown[]
}

function wireSlots(slots: Slots) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'agent_events') return makeQueryChain({ data: slots.errors, error: null })
    if (table === 'task_queue') return makeQueryChain({ data: slots.stuck, error: null })
    return makeQueryChain({ data: [], error: null })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildQuotaCliffLine — clean baseline', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns clean ✅ line when 0 errors and 0 stuck tasks', async () => {
    wireSlots({ errors: [], stuck: [] })
    const result = await buildQuotaCliffLine()
    expect(result).toBe('Routines quota: clean (24h) ✅')
  })
})

describe('buildQuotaCliffLine — 429 events present, no stuck tasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ⚠️ line with count when errors present but nothing bricked', async () => {
    wireSlots({ errors: [{ id: '1' }, { id: '2' }, { id: '3' }], stuck: [] })
    const result = await buildQuotaCliffLine()
    expect(result).toContain('3×429 events')
    expect(result).toContain('⚠️')
    expect(result).toContain('no tasks bricked yet')
    expect(result).not.toContain('❌')
  })

  it('counts a single 429 event correctly', async () => {
    wireSlots({ errors: [{ id: '1' }], stuck: [] })
    const result = await buildQuotaCliffLine()
    expect(result).toContain('1×429 events')
    expect(result).toContain('⚠️')
  })
})

describe('buildQuotaCliffLine — stuck-claimed tasks present', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ❌ line with action hint when stuck tasks exist', async () => {
    wireSlots({
      errors: [{ id: '1' }, { id: '2' }],
      stuck: [{ id: 'task-a' }, { id: 'task-b' }],
    })
    const result = await buildQuotaCliffLine()
    expect(result).toContain('2×429 events')
    expect(result).toContain('2 tasks stuck-claimed')
    expect(result).toContain('❌')
    expect(result).toContain('💡 Predictive quota check needed')
  })

  it('uses singular "task" when exactly 1 task is stuck', async () => {
    wireSlots({ errors: [{ id: '1' }], stuck: [{ id: 'task-a' }] })
    const result = await buildQuotaCliffLine()
    expect(result).toContain('1 task stuck-claimed')
    expect(result).not.toContain('1 tasks')
  })

  it('uses plural "tasks" when multiple tasks are stuck', async () => {
    wireSlots({ errors: [{ id: '1' }], stuck: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
    const result = await buildQuotaCliffLine()
    expect(result).toContain('3 tasks stuck-claimed')
  })

  it('returns ❌ even when error count is 0 but tasks are stuck', async () => {
    wireSlots({ errors: [], stuck: [{ id: 'task-a' }] })
    const result = await buildQuotaCliffLine()
    expect(result).toContain('0×429 events')
    expect(result).toContain('1 task stuck-claimed')
    expect(result).toContain('❌')
  })
})

describe('buildQuotaCliffLine — DB error (never throws)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns fallback string when DB throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('connection refused')
    })
    const result = await buildQuotaCliffLine()
    expect(result).toBe('Routines quota: stats unavailable')
  })

  it('returns fallback string when DB rejects', async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockRejectedValue(new Error('db error')),
      filter: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    }))
    const result = await buildQuotaCliffLine()
    expect(result).toBe('Routines quota: stats unavailable')
  })
})
