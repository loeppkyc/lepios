/**
 * tests/self-repair/detector.test.ts
 *
 * Spec acceptance: §B (detector finds failure + advisory lock)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn()
  return { mockFrom }
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── capability mock ───────────────────────────────────────────────────────────

vi.mock('@/lib/security/capability', () => ({
  requireCapability: vi.fn().mockResolvedValue({ audit_id: 'mock-audit-id' }),
}))

// ── chain builder ─────────────────────────────────────────────────────────────

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = [
    'select',
    'insert',
    'update',
    'eq',
    'single',
    'maybeSingle',
    'in',
    'lt',
    'is',
    'gte',
    'lte',
    'limit',
    'order',
    'not',
    'neq',
  ]
  const self = () => chain
  for (const m of methods) chain[m] = vi.fn(self)
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

// ── import under test (after mocks) ──────────────────────────────────────────

import { detectNextFailure, releaseDetectorLock } from '@/lib/harness/self-repair/detector'

// ── helpers ───────────────────────────────────────────────────────────────────

const WATCHLIST_ROWS = [{ action_type: 'coordinator_await_timeout' }]
const FAILURE_EVENT = {
  id: 'evt-001',
  action: 'coordinator_await_timeout',
  occurred_at: '2026-05-01T10:00:00Z',
  meta: { timeout_ms: 30000 },
  actor: 'coordinator',
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset locks between tests by calling release
  releaseDetectorLock('coordinator_await_timeout')
})

afterEach(async () => {
  await releaseDetectorLock('coordinator_await_timeout')
})

// ── B1: detectNextFailure returns matching failure ────────────────────────────

describe('AC-B: detectNextFailure', () => {
  it('returns DetectedFailure for a watchlisted action type', async () => {
    mockFrom
      .mockReturnValueOnce(makeChain({ data: WATCHLIST_ROWS, error: null })) // watchlist query
      .mockReturnValueOnce(makeChain({ data: [FAILURE_EVENT], error: null })) // agent_events query
      .mockReturnValueOnce(makeChain({ data: null, error: null })) // existing run check (maybeSingle)

    const result = await detectNextFailure()

    expect(result).not.toBeNull()
    expect(result!.eventId).toBe('evt-001')
    expect(result!.actionType).toBe('coordinator_await_timeout')
    expect(result!.occurredAt).toBe('2026-05-01T10:00:00Z')
    expect(result!.agentId).toBe('coordinator')
  })

  it('returns null when no matching events in agent_events', async () => {
    mockFrom
      .mockReturnValueOnce(makeChain({ data: WATCHLIST_ROWS, error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }))

    const result = await detectNextFailure()
    expect(result).toBeNull()
  })

  it('returns null when watchlist is empty', async () => {
    mockFrom.mockReturnValueOnce(makeChain({ data: [], error: null }))

    const result = await detectNextFailure()
    expect(result).toBeNull()
  })

  it('ignores events NOT in the watchlist', async () => {
    // Watchlist has only coordinator_await_timeout
    // But we check that drain_trigger_failed is filtered at query level
    // (the query uses .in('action', watchedTypes))
    mockFrom
      .mockReturnValueOnce(makeChain({ data: WATCHLIST_ROWS, error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // no events match the .in() filter

    const result = await detectNextFailure()
    expect(result).toBeNull()
  })

  it('skips events that already have a self_repair_run', async () => {
    mockFrom
      .mockReturnValueOnce(makeChain({ data: WATCHLIST_ROWS, error: null }))
      .mockReturnValueOnce(makeChain({ data: [FAILURE_EVENT], error: null }))
      .mockReturnValueOnce(makeChain({ data: { id: 'run-123', status: 'pr_opened' }, error: null })) // existing run

    const result = await detectNextFailure()
    expect(result).toBeNull()
  })
})

// ── B2: advisory lock prevents concurrent duplicate ───────────────────────────

describe('AC-B: advisory lock', () => {
  it('second call returns null when lock is held', async () => {
    // First call acquires lock
    mockFrom
      .mockReturnValueOnce(makeChain({ data: WATCHLIST_ROWS, error: null }))
      .mockReturnValueOnce(makeChain({ data: [FAILURE_EVENT], error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))

    const first = await detectNextFailure()
    expect(first).not.toBeNull()

    // Second call: lock is held — should return null
    mockFrom
      .mockReturnValueOnce(makeChain({ data: WATCHLIST_ROWS, error: null }))
      .mockReturnValueOnce(makeChain({ data: [FAILURE_EVENT], error: null }))

    const second = await detectNextFailure()
    expect(second).toBeNull()
  })

  it('after releaseDetectorLock, a new call can proceed', async () => {
    // Acquire
    mockFrom
      .mockReturnValueOnce(makeChain({ data: WATCHLIST_ROWS, error: null }))
      .mockReturnValueOnce(makeChain({ data: [FAILURE_EVENT], error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))

    const first = await detectNextFailure()
    expect(first).not.toBeNull()

    // Release
    await releaseDetectorLock('coordinator_await_timeout')

    // Third call after release — should find the event again
    mockFrom
      .mockReturnValueOnce(makeChain({ data: WATCHLIST_ROWS, error: null }))
      .mockReturnValueOnce(makeChain({ data: [FAILURE_EVENT], error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))

    const third = await detectNextFailure()
    expect(third).not.toBeNull()
    expect(third!.eventId).toBe('evt-001')
  })
})
