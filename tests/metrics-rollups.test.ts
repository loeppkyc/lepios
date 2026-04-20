/**
 * Unit tests for lib/metrics/rollups.ts.
 *
 * Mocks @/lib/supabase/service. Tests cover empty data, single-day data,
 * and multi-day data for each function. Does NOT test Telegram sending.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock service client ───────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import {
  getDailySuccessRate,
  getSafetyFlagTrend,
  getTopErrorTypes,
  getKnowledgeHealth,
  getAutonomousRunSummary,
} from '@/lib/metrics/rollups'

// ── Builder factory ───────────────────────────────────────────────────────────

function makeBuilder(data: unknown[], error: unknown = null) {
  const resolved = { data, error }
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    then: (resolve: (v: typeof resolved) => void) => Promise.resolve(resolved).then(resolve),
  }
}

beforeEach(() => vi.clearAllMocks())

// ── getDailySuccessRate ───────────────────────────────────────────────────────

describe('getDailySuccessRate', () => {
  it('returns empty array when no events exist', async () => {
    mockFrom.mockReturnValue(makeBuilder([]))
    expect(await getDailySuccessRate(7)).toEqual([])
  })

  it('returns empty array on Supabase error', async () => {
    mockFrom.mockReturnValue(makeBuilder([], { message: 'fail' }))
    expect(await getDailySuccessRate(7)).toEqual([])
  })

  it('single-day: computes rate from successes and total', async () => {
    mockFrom.mockReturnValue(makeBuilder([
      { occurred_at: '2026-04-19T10:00:00Z', status: 'success' },
      { occurred_at: '2026-04-19T11:00:00Z', status: 'success' },
      { occurred_at: '2026-04-19T12:00:00Z', status: 'failure' },
      { occurred_at: '2026-04-19T13:00:00Z', status: 'warning' },
    ]))
    const result = await getDailySuccessRate(1)
    expect(result).toHaveLength(1)
    expect(result[0].day).toBe('2026-04-19')
    expect(result[0].total).toBe(4)
    expect(result[0].successes).toBe(2)
    expect(result[0].rate).toBe(50)  // 2/4 = 50%
  })

  it('multi-day: groups by day and sorts ascending', async () => {
    mockFrom.mockReturnValue(makeBuilder([
      { occurred_at: '2026-04-18T10:00:00Z', status: 'success' },
      { occurred_at: '2026-04-19T10:00:00Z', status: 'success' },
      { occurred_at: '2026-04-19T11:00:00Z', status: 'failure' },
    ]))
    const result = await getDailySuccessRate(2)
    expect(result).toHaveLength(2)
    expect(result[0].day).toBe('2026-04-18')
    expect(result[0].rate).toBe(100)
    expect(result[1].day).toBe('2026-04-19')
    expect(result[1].rate).toBe(50)
  })

  it('returns 0% rate when day has zero successes', async () => {
    mockFrom.mockReturnValue(makeBuilder([
      { occurred_at: '2026-04-19T10:00:00Z', status: 'failure' },
      { occurred_at: '2026-04-19T11:00:00Z', status: 'error' },
    ]))
    const result = await getDailySuccessRate(1)
    expect(result[0].rate).toBe(0)
  })
})

// ── getSafetyFlagTrend ────────────────────────────────────────────────────────

describe('getSafetyFlagTrend', () => {
  it('returns empty array when no safety events exist', async () => {
    mockFrom.mockReturnValue(makeBuilder([]))
    expect(await getSafetyFlagTrend(7)).toEqual([])
  })

  it('extracts severity_breakdown from meta', async () => {
    mockFrom.mockReturnValue(makeBuilder([
      {
        occurred_at: '2026-04-19T10:00:00Z',
        meta: { severity_breakdown: { critical: 1, high: 2, medium: 1, low: 0 } },
      },
    ]))
    const result = await getSafetyFlagTrend(1)
    expect(result).toHaveLength(1)
    expect(result[0].critical).toBe(1)
    expect(result[0].high).toBe(2)
    expect(result[0].medium).toBe(1)
    expect(result[0].low).toBe(0)
    expect(result[0].total).toBe(4)
  })

  it('handles missing or null meta gracefully', async () => {
    mockFrom.mockReturnValue(makeBuilder([
      { occurred_at: '2026-04-19T10:00:00Z', meta: null },
    ]))
    const result = await getSafetyFlagTrend(1)
    expect(result[0].total).toBe(0)
  })

  it('multi-day: accumulates flags per day', async () => {
    mockFrom.mockReturnValue(makeBuilder([
      { occurred_at: '2026-04-18T10:00:00Z', meta: { severity_breakdown: { high: 1 } } },
      { occurred_at: '2026-04-18T11:00:00Z', meta: { severity_breakdown: { high: 2 } } },
      { occurred_at: '2026-04-19T10:00:00Z', meta: { severity_breakdown: { critical: 1 } } },
    ]))
    const result = await getSafetyFlagTrend(2)
    expect(result).toHaveLength(2)
    const apr18 = result.find((r) => r.day === '2026-04-18')!
    expect(apr18.high).toBe(3)
    const apr19 = result.find((r) => r.day === '2026-04-19')!
    expect(apr19.critical).toBe(1)
  })
})

// ── getTopErrorTypes ──────────────────────────────────────────────────────────

describe('getTopErrorTypes', () => {
  it('returns empty array when no errors exist', async () => {
    mockFrom.mockReturnValue(makeBuilder([]))
    expect(await getTopErrorTypes(7)).toEqual([])
  })

  it('groups and counts by error_type, descending', async () => {
    mockFrom.mockReturnValue(makeBuilder([
      { error_type: 'TypeError', error_message: 'Cannot read' },
      { error_type: 'TypeError', error_message: 'Cannot read x' },
      { error_type: 'NetworkError', error_message: 'ECONNREFUSED' },
    ]))
    const result = await getTopErrorTypes(7, 5)
    expect(result[0].error_type).toBe('TypeError')
    expect(result[0].count).toBe(2)
    expect(result[1].error_type).toBe('NetworkError')
    expect(result[1].count).toBe(1)
  })

  it('preserves example_message from first occurrence', async () => {
    mockFrom.mockReturnValue(makeBuilder([
      { error_type: 'TypeError', error_message: 'first message' },
      { error_type: 'TypeError', error_message: 'second message' },
    ]))
    const result = await getTopErrorTypes(7)
    expect(result[0].example_message).toBe('first message')
  })

  it('respects limit parameter', async () => {
    mockFrom.mockReturnValue(makeBuilder([
      { error_type: 'A', error_message: null },
      { error_type: 'B', error_message: null },
      { error_type: 'C', error_message: null },
    ]))
    const result = await getTopErrorTypes(7, 2)
    expect(result).toHaveLength(2)
  })

  it('returns empty array on Supabase error', async () => {
    mockFrom.mockReturnValue(makeBuilder([], { message: 'fail' }))
    expect(await getTopErrorTypes(7)).toEqual([])
  })
})

// ── getKnowledgeHealth ────────────────────────────────────────────────────────

describe('getKnowledgeHealth', () => {
  it('returns zero-state when no knowledge entries exist', async () => {
    mockFrom.mockReturnValue(makeBuilder([]))
    const result = await getKnowledgeHealth()
    expect(result.total).toBe(0)
    expect(result.avgConfidence).toBe(0)
    expect(result.usedLast7Days).toBe(0)
    expect(result.decayedCount).toBe(0)
  })

  it('computes avgConfidence correctly', async () => {
    const week = new Date(Date.now() - 3 * 86_400_000).toISOString()
    mockFrom.mockReturnValue(makeBuilder([
      { category: 'error_fix', confidence: 0.8, last_used_at: null },
      { category: 'principle', confidence: 0.6, last_used_at: null },
    ]))
    const result = await getKnowledgeHealth()
    expect(result.total).toBe(2)
    expect(result.avgConfidence).toBe(0.7)
  })

  it('counts entries used in last 7 days', async () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString()
    mockFrom.mockReturnValue(makeBuilder([
      { category: 'tip', confidence: 0.5, last_used_at: recent },
      { category: 'tip', confidence: 0.5, last_used_at: old },
      { category: 'tip', confidence: 0.5, last_used_at: null },
    ]))
    const result = await getKnowledgeHealth()
    expect(result.usedLast7Days).toBe(1)
  })

  it('counts decayed entries (confidence < 0.2)', async () => {
    mockFrom.mockReturnValue(makeBuilder([
      { category: 'tip', confidence: 0.15, last_used_at: null },
      { category: 'tip', confidence: 0.19, last_used_at: null },
      { category: 'tip', confidence: 0.5, last_used_at: null },
    ]))
    const result = await getKnowledgeHealth()
    expect(result.decayedCount).toBe(2)
  })

  it('groups by category', async () => {
    mockFrom.mockReturnValue(makeBuilder([
      { category: 'error_fix', confidence: 0.5, last_used_at: null },
      { category: 'error_fix', confidence: 0.6, last_used_at: null },
      { category: 'principle', confidence: 0.7, last_used_at: null },
    ]))
    const result = await getKnowledgeHealth()
    expect(result.byCategory['error_fix']).toBe(2)
    expect(result.byCategory['principle']).toBe(1)
  })
})

// ── getAutonomousRunSummary ───────────────────────────────────────────────────

describe('getAutonomousRunSummary', () => {
  function makeBuilderMulti(
    eventsData: unknown[],
    knowledgeData: unknown[],
    eventsError: unknown = null,
  ) {
    let callCount = 0
    return vi.fn().mockImplementation(() => {
      callCount++
      // First call = agent_events, second call = knowledge (for getKnowledgeHealth)
      if (callCount === 1) return makeBuilder(eventsData, eventsError)
      return makeBuilder(knowledgeData)
    })
  }

  it('returns zero-state summary when no events exist', async () => {
    mockFrom.mockImplementation(() => makeBuilder([]))
    const result = await getAutonomousRunSummary(7)
    expect(result.totalEvents).toBe(0)
    expect(result.successRate).toBe(0)
    expect(result.errorRate).toBe(0)
  })

  it('computes successRate from events', async () => {
    let call = 0
    mockFrom.mockImplementation(() => {
      call++
      if (call === 1) {
        return makeBuilder([
          { status: 'success', duration_ms: 100, tokens_used: 50, domain: 'pageprofit', action: 'scan', meta: null },
          { status: 'success', duration_ms: 200, tokens_used: 50, domain: 'pageprofit', action: 'scan', meta: null },
          { status: 'failure', duration_ms: 50,  tokens_used: 0,  domain: 'pageprofit', action: 'scan', meta: null },
        ])
      }
      return makeBuilder([]) // knowledge table empty
    })

    const result = await getAutonomousRunSummary(7)
    expect(result.totalEvents).toBe(3)
    expect(result.successRate).toBe(67)   // 2/3 rounded
    expect(result.errorRate).toBe(33)     // 1/3 rounded
  })

  it('computes avgDurationMs from non-null durations only', async () => {
    let call = 0
    mockFrom.mockImplementation(() => {
      call++
      if (call === 1) {
        return makeBuilder([
          { status: 'success', duration_ms: 100, tokens_used: 0, domain: 'x', action: 'y', meta: null },
          { status: 'success', duration_ms: null, tokens_used: 0, domain: 'x', action: 'y', meta: null },
          { status: 'success', duration_ms: 300, tokens_used: 0, domain: 'x', action: 'y', meta: null },
        ])
      }
      return makeBuilder([])
    })
    const result = await getAutonomousRunSummary(1)
    expect(result.avgDurationMs).toBe(200) // (100+300)/2
  })

  it('counts safety flags from meta.check_count', async () => {
    let call = 0
    mockFrom.mockImplementation(() => {
      call++
      if (call === 1) {
        return makeBuilder([
          {
            status: 'success', duration_ms: null, tokens_used: 0,
            domain: 'safety', action: 'safety.check',
            meta: { check_count: 3, blocking: false },
          },
          {
            status: 'failure', duration_ms: null, tokens_used: 0,
            domain: 'safety', action: 'safety.check',
            meta: { check_count: 1, blocking: true },
          },
        ])
      }
      return makeBuilder([])
    })
    const result = await getAutonomousRunSummary(1)
    expect(result.safetyFlagsTotal).toBe(4)   // 3 + 1
    expect(result.blockingSafetyRuns).toBe(1)
  })

  it('returns empty state on Supabase error — never throws', async () => {
    let call = 0
    mockFrom.mockImplementation(() => {
      call++
      if (call === 1) return makeBuilder([], { message: 'fail' })
      return makeBuilder([])
    })
    await expect(getAutonomousRunSummary(7)).resolves.toBeDefined()
    const result = await getAutonomousRunSummary(7)
    expect(result.totalEvents).toBe(0)
  })
})
