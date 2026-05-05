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

/**
 * Route mockFrom() calls by table name so the detector can call any number of
 * tables in any order without the test caring about call sequence. The
 * detector's call graph evolves (e.g. checkAndAutoSuspend, watchlist reload),
 * and test fixtures shouldn't have to track every new query.
 *
 * Pass a map of table → result. Default for any unconfigured table:
 * `{ data: [], error: null }` — empty rows, no error.
 */
function setupTables(map: Record<string, unknown>) {
  mockFrom.mockImplementation((table: string) => {
    const result = table in map ? map[table] : { data: [], error: null }
    return makeChain(result)
  })
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
    setupTables({
      self_repair_watchlist: { data: WATCHLIST_ROWS, error: null },
      agent_events: { data: [FAILURE_EVENT], error: null },
      self_repair_runs: { data: null, error: null }, // no existing run, no auto-suspend trigger
    })

    const result = await detectNextFailure()

    expect(result).not.toBeNull()
    expect(result!.eventId).toBe('evt-001')
    expect(result!.actionType).toBe('coordinator_await_timeout')
    expect(result!.occurredAt).toBe('2026-05-01T10:00:00Z')
    expect(result!.agentId).toBe('coordinator')
  })

  it('returns null when no matching events in agent_events', async () => {
    setupTables({
      self_repair_watchlist: { data: WATCHLIST_ROWS, error: null },
      agent_events: { data: [], error: null },
      self_repair_runs: { data: null, error: null },
    })

    const result = await detectNextFailure()
    expect(result).toBeNull()
  })

  it('returns null when watchlist is empty', async () => {
    setupTables({
      self_repair_watchlist: { data: [], error: null },
    })

    const result = await detectNextFailure()
    expect(result).toBeNull()
  })

  it('ignores events NOT in the watchlist', async () => {
    // Watchlist has only coordinator_await_timeout. The query uses
    // .in('action', watchedTypes), so non-watched types are filtered server-side
    // and the agent_events fixture below is what the DB would return.
    setupTables({
      self_repair_watchlist: { data: WATCHLIST_ROWS, error: null },
      agent_events: { data: [], error: null },
      self_repair_runs: { data: null, error: null },
    })

    const result = await detectNextFailure()
    expect(result).toBeNull()
  })

  it('skips events that already have a self_repair_run', async () => {
    setupTables({
      self_repair_watchlist: { data: WATCHLIST_ROWS, error: null },
      agent_events: { data: [FAILURE_EVENT], error: null },
      self_repair_runs: { data: { id: 'run-123', status: 'pr_opened' }, error: null },
    })

    const result = await detectNextFailure()
    expect(result).toBeNull()
  })
})

// ── B2: advisory lock prevents concurrent duplicate ───────────────────────────

describe('AC-B: advisory lock', () => {
  it('second call returns null when lock is held', async () => {
    setupTables({
      self_repair_watchlist: { data: WATCHLIST_ROWS, error: null },
      agent_events: { data: [FAILURE_EVENT], error: null },
      self_repair_runs: { data: null, error: null },
    })

    const first = await detectNextFailure()
    expect(first).not.toBeNull()

    // Second call: lock is held — should return null even with the same fixture data.
    const second = await detectNextFailure()
    expect(second).toBeNull()
  })

  it('after releaseDetectorLock, a new call can proceed', async () => {
    setupTables({
      self_repair_watchlist: { data: WATCHLIST_ROWS, error: null },
      agent_events: { data: [FAILURE_EVENT], error: null },
      self_repair_runs: { data: null, error: null },
    })

    const first = await detectNextFailure()
    expect(first).not.toBeNull()

    await releaseDetectorLock('coordinator_await_timeout')

    const third = await detectNextFailure()
    expect(third).not.toBeNull()
    expect(third!.eventId).toBe('evt-001')
  })
})
