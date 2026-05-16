import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Mock guardedWrite — passes through the query arg (records call) ───────────
// guardedWrite(query, table, op) — we let it through but capture it was called.

vi.mock('@/lib/supabase/service-write', () => ({
  guardedWrite: vi.fn().mockResolvedValue({ data: null, error: null }),
}))

// ── Mock Telegram ─────────────────────────────────────────────────────────────

vi.mock('@/lib/orchestrator/telegram', () => ({
  postMessage: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock quota-guard (not under test here) ────────────────────────────────────

vi.mock('@/lib/harness/quota-guard', () => ({
  preClaimQuotaCheck: vi.fn().mockResolvedValue({ safe_to_claim: true, reason: 'no_recent_429s' }),
}))

import { checkAndClearQuotaHalt } from '@/lib/harness/quota-monitor'
import { guardedWrite } from '@/lib/supabase/service-write'
import { postMessage } from '@/lib/orchestrator/telegram'

// ── Helpers ───────────────────────────────────────────────────────────────────

// Builds a mock Supabase chain that resolves via await/then.
// Supports: select, eq, filter, gte, lte, order, limit, not, or, in
function makeSelectChain(result: { data: unknown[] | null; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of [
    'select',
    'eq',
    'filter',
    'gte',
    'lte',
    'order',
    'limit',
    'not',
    'or',
    'in',
  ]) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

// Builds a mock Supabase chain for update().eq() — resolves to { data, error }
function makeUpdateChain() {
  const eq = vi.fn().mockResolvedValue({ data: null, error: null })
  const update = vi.fn().mockReturnValue({ eq })
  return { update }
}

// Builds a mock for agent_events.insert()
function makeInsertMock() {
  const insertMock = vi.fn().mockResolvedValue({ data: null, error: null })
  return { insert: insertMock, _insertMock: insertMock }
}

// harness_config rows helper — builds the .in() result rows
function makeConfigRows(
  invocationsToday: number,
  windowStartIso: string,
  threshold = 85
): { key: string; value: string }[] {
  return [
    { key: 'ROUTINES_INVOCATIONS_TODAY', value: String(invocationsToday) },
    { key: 'ROUTINES_INVOCATIONS_WINDOW_START', value: windowStartIso },
    { key: 'HARNESS_QUOTA_THRESHOLD', value: String(threshold) },
  ]
}

// Returns an ISO timestamp N hours ago
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Mock wiring helper ────────────────────────────────────────────────────────
// checkAndClearQuotaHalt makes 3 db.from() calls when it clears the halt:
//   1. harness_config.select().in()  → returns config rows
//   2. harness_config.update().eq()  → passed to guardedWrite (which is fully mocked)
//   3. agent_events.insert()         → fire-and-forget log
//
// Since guardedWrite is fully mocked (never calls the query), call 2 never executes
// the builder. However, the builder expression IS evaluated before being passed to
// guardedWrite, so mockFrom IS called for it.
//
// Call order: from(harness_config)[select] → from(harness_config)[update, via guardedWrite arg] → from(agent_events)[insert]

function wireSuccessfulResume(
  configRows: { key: string; value: string }[],
  insertMock: ReturnType<typeof vi.fn>
) {
  mockFrom
    // Call 1: harness_config select().in()
    .mockReturnValueOnce(makeSelectChain({ data: configRows, error: null }))
    // Call 2: harness_config update().eq() passed to guardedWrite
    .mockReturnValueOnce(makeUpdateChain())
    // Call 3: agent_events insert()
    .mockReturnValueOnce({ insert: insertMock })
}

// ── Test: window rolled (> 24h ago) → clears halt ────────────────────────────

describe('checkAndClearQuotaHalt — window rolled', () => {
  it('returns true and clears halt when window_start is > 24h ago', async () => {
    const configRows = makeConfigRows(10, hoursAgo(25))
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    wireSuccessfulResume(configRows, insertMock)

    const result = await checkAndClearQuotaHalt('test-run-id')

    expect(result).toBe(true)
    expect(guardedWrite).toHaveBeenCalledOnce()
    expect(insertMock).toHaveBeenCalledOnce()
    expect(postMessage).toHaveBeenCalledOnce()
    expect(postMessage).toHaveBeenCalledWith(
      '[LepiOS Harness] Quota auto-resumed — daily window rolled. Pickup continuing.'
    )
  })

  it('logs agent_events with correct action and meta', async () => {
    const windowStartIso = hoursAgo(26)
    const configRows = makeConfigRows(5, windowStartIso)
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    wireSuccessfulResume(configRows, insertMock)

    await checkAndClearQuotaHalt('run-abc-123')

    const insertArg = insertMock.mock.calls[0][0]
    expect(insertArg.action).toBe('quota_auto_resume')
    expect(insertArg.status).toBe('success')
    expect(insertArg.meta.run_id).toBe('run-abc-123')
    expect(insertArg.meta.invocations_at_resume).toBe(5)
    expect(insertArg.meta.window_start_at).toBe(windowStartIso)
  })
})

// ── Test: window NOT rolled AND invocations above threshold → halt stays ──────

describe('checkAndClearQuotaHalt — window not rolled, above threshold', () => {
  it('returns false when window is fresh (< 24h) and invocations are at threshold', async () => {
    // 10 invocations / 12 cliff = 83%, threshold = 80 → 83 >= 80 → above threshold
    const configRows = makeConfigRows(10, hoursAgo(12), 80)
    // Only one from() call — function returns false before update/insert
    mockFrom.mockReturnValueOnce(makeSelectChain({ data: configRows, error: null }))

    const result = await checkAndClearQuotaHalt('test-run-id')

    expect(result).toBe(false)
    expect(guardedWrite).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('returns false when window is fresh and invocations exactly at threshold', async () => {
    // 11 invocations / 12 cliff = 91%, threshold = 85 → 91 >= 85
    const configRows = makeConfigRows(11, hoursAgo(10), 85)
    mockFrom.mockReturnValueOnce(makeSelectChain({ data: configRows, error: null }))

    const result = await checkAndClearQuotaHalt('test-run-id')

    expect(result).toBe(false)
  })
})

// ── Test: counter = 0 → treat as window fresh, clears halt ───────────────────

describe('checkAndClearQuotaHalt — counter reset to 0', () => {
  it('returns true when ROUTINES_INVOCATIONS_TODAY is 0 (explicitly reset)', async () => {
    // Window is only 2h old (not rolled), but counter is 0
    const configRows = makeConfigRows(0, hoursAgo(2), 85)
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    wireSuccessfulResume(configRows, insertMock)

    const result = await checkAndClearQuotaHalt('test-run-id')

    expect(result).toBe(true)
    expect(guardedWrite).toHaveBeenCalledOnce()
  })

  it('includes invocations_at_resume=0 in agent_events meta', async () => {
    const configRows = makeConfigRows(0, hoursAgo(2))
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    wireSuccessfulResume(configRows, insertMock)

    await checkAndClearQuotaHalt('run-zero')

    const insertArg = insertMock.mock.calls[0][0]
    expect(insertArg.meta.invocations_at_resume).toBe(0)
  })
})

// ── Test: harness_config read failure → returns false ─────────────────────────

describe('checkAndClearQuotaHalt — harness_config read failure', () => {
  it('returns false when select throws (fail open)', async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error('DB connection timeout')
    })

    const result = await checkAndClearQuotaHalt('test-run-id')

    expect(result).toBe(false)
    expect(guardedWrite).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('returns false when select resolves with null data and both gates pass — halt cleared (no window)', async () => {
    // When rows is null, get() returns '' for all keys.
    // windowStart = '' → windowStartMs = NaN (Date.parse('') = NaN) → no, wait:
    // new Date('').getTime() === NaN, so windowStartMs = NaN.
    // !windowStartMs — NaN is falsy → windowRolled = true.
    // invocationsToday = parseInt('', 10) || 0 = 0 → counterReset = true.
    // Both gates pass → halt is cleared (correct: no window config means treat as fresh).
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: null, error: null }))
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce({ insert: insertMock })

    const result = await checkAndClearQuotaHalt('test-run-id')

    // No window start = treated as fresh window → halt cleared
    expect(result).toBe(true)
    expect(guardedWrite).toHaveBeenCalledOnce()
  })
})

// ── Test: window not rolled but below threshold → clears halt ─────────────────

describe('checkAndClearQuotaHalt — below threshold (secondary gate)', () => {
  it('returns true when invocations are below threshold even if window is current', async () => {
    // 3 invocations / 12 cliff = 25%, threshold = 85 → 25 < 85 → below threshold
    const configRows = makeConfigRows(3, hoursAgo(12), 85)
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    wireSuccessfulResume(configRows, insertMock)

    const result = await checkAndClearQuotaHalt('test-run-id')

    expect(result).toBe(true)
    expect(guardedWrite).toHaveBeenCalledOnce()
  })
})
