/**
 * Tests for lib/harness/telegram-stats.ts
 *
 * Covers:
 *   buildDrainStatsLine:
 *     - Returns summed delivered + failed counts from drain_run events in last 24h
 *     - Returns "0 delivered, 0 failed" when no drain_run events
 *     - Returns "unavailable" on DB error (never throws)
 *
 *   buildReviewTimeoutLine:
 *     - Returns null when count = 0 (omit from digest when healthy)
 *     - Returns ⚠️ line with count when count > 0
 *     - Returns null on DB error (never throws)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { buildDrainStatsLine, buildReviewTimeoutLine } from '@/lib/harness/telegram-stats'

// ── Chain builder ─────────────────────────────────────────────────────────────

type QueryResult = { data: unknown; error: null | { message: string } }

function makeQueryChain(result: QueryResult) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

// ── buildDrainStatsLine ───────────────────────────────────────────────────────

describe('buildDrainStatsLine', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns summed delivered and failed counts across drain_run events', async () => {
    mockFrom.mockReturnValue(
      makeQueryChain({
        data: [
          { meta: { drained: 3, failed: 0 } },
          { meta: { drained: 1, failed: 1 } },
          { meta: { drained: 0, failed: 0 } },
        ],
        error: null,
      })
    )
    const result = await buildDrainStatsLine()
    expect(result).toBe('Notifications drained (24h): 4 delivered, 1 failed')
  })

  it('returns 0 delivered and 0 failed when no drain_run events', async () => {
    mockFrom.mockReturnValue(makeQueryChain({ data: [], error: null }))
    const result = await buildDrainStatsLine()
    expect(result).toBe('Notifications drained (24h): 0 delivered, 0 failed')
  })

  it('handles missing meta.drained/failed gracefully (defaults to 0)', async () => {
    mockFrom.mockReturnValue(
      makeQueryChain({
        data: [{ meta: null }, { meta: {} }],
        error: null,
      })
    )
    const result = await buildDrainStatsLine()
    expect(result).toBe('Notifications drained (24h): 0 delivered, 0 failed')
  })

  it('returns "unavailable" on DB error (never throws)', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('connection refused')
    })
    const result = await buildDrainStatsLine()
    expect(result).toBe('Notifications drained (24h): unavailable')
  })

  it('queries action=drain_run in agent_events', async () => {
    const chain = makeQueryChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain)
    await buildDrainStatsLine()
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    expect(chain.eq as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('action', 'drain_run')
  })
})

// ── buildReviewTimeoutLine ────────────────────────────────────────────────────

describe('buildReviewTimeoutLine', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when count = 0 (healthy — omit from digest)', async () => {
    mockFrom.mockReturnValue(makeQueryChain({ data: [], error: null }))
    const result = await buildReviewTimeoutLine()
    expect(result).toBeNull()
  })

  it('returns ⚠️ line with count when N > 0', async () => {
    mockFrom.mockReturnValue(
      makeQueryChain({
        data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        error: null,
      })
    )
    const result = await buildReviewTimeoutLine()
    expect(result).toBe('⚠️ Review timeouts swept (24h): 3')
  })

  it('returns null on DB error (never throws)', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('DB down')
    })
    const result = await buildReviewTimeoutLine()
    expect(result).toBeNull()
  })

  it('queries action=purpose_review.timeout in agent_events', async () => {
    const chain = makeQueryChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain)
    await buildReviewTimeoutLine()
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    expect(chain.eq as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'action',
      'purpose_review.timeout'
    )
  })
})
