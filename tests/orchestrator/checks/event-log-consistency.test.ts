import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/orchestrator/config', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/orchestrator/config')>()
  return {
    ...orig,
    getYesterdayRangeMT: vi.fn(() => ({
      start: '2026-04-19T06:00:00.000Z',
      end: '2026-04-20T06:00:00.000Z',
    })),
  }
})

import { checkEventLogConsistency } from '@/lib/orchestrator/checks/event-log-consistency'

// Fixed "now" so stuck-processing age calculations are deterministic
const FAKE_NOW = Date.parse('2026-04-20T08:00:00.000Z')

let evtCounter = 0
function makeEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt-${++evtCounter}`,
    domain: 'orchestrator',
    status: 'success',
    duration_ms: 100,
    occurred_at: '2026-04-19T10:00:00.000Z',
    ...overrides,
  }
}

function makeSelectBuilder(data: unknown[], error: null | { message: string } = null) {
  const result = { data, error }
  return {
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    then: (resolve: (v: typeof result) => void) => Promise.resolve(result).then(resolve),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(FAKE_NOW)
  evtCounter = 0
})

afterEach(() => vi.useRealTimers())

describe('checkEventLogConsistency', () => {
  it('returns pass with no flags for clean events', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([makeEventRow()]))
    const result = await checkEventLogConsistency()
    expect(result.name).toBe('event_log_consistency')
    expect(result.status).toBe('pass')
    expect(result.flags).toHaveLength(0)
    expect(result.counts.total).toBe(1)
  })

  it('returns pass with zero events', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([]))
    const result = await checkEventLogConsistency()
    expect(result.status).toBe('pass')
    expect(result.counts.total).toBe(0)
  })

  it('flags events stuck in processing beyond threshold', async () => {
    // 10 min ago — well past the 5 min threshold
    const stuckAt = new Date(FAKE_NOW - 10 * 60 * 1000).toISOString()
    mockFrom.mockReturnValue(
      makeSelectBuilder([makeEventRow({ status: 'processing', occurred_at: stuckAt })])
    )
    const result = await checkEventLogConsistency()
    expect(result.counts.stuck_processing).toBe(1)
    expect(result.flags.some((f) => f.message.includes('stuck'))).toBe(true)
    expect(result.status).toBe('warn')
  })

  it('does NOT flag processing event younger than threshold', async () => {
    // 1 min ago — under the 5 min threshold
    const recentAt = new Date(FAKE_NOW - 60 * 1000).toISOString()
    mockFrom.mockReturnValue(
      makeSelectBuilder([makeEventRow({ status: 'processing', occurred_at: recentAt })])
    )
    const result = await checkEventLogConsistency()
    expect(result.counts.stuck_processing).toBe(0)
  })

  it('flags slow events (duration_ms > 30000)', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([makeEventRow({ duration_ms: 45_000 })]))
    const result = await checkEventLogConsistency()
    expect(result.counts.slow_events).toBe(1)
    expect(result.flags.some((f) => f.message.includes('slow event'))).toBe(true)
  })

  it('does NOT flag events at exactly the threshold (30000ms is not > 30000)', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([makeEventRow({ duration_ms: 30_000 })]))
    const result = await checkEventLogConsistency()
    expect(result.counts.slow_events).toBe(0)
  })

  it('flags unknown domain values', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([makeEventRow({ domain: 'unknown_xyz' })]))
    const result = await checkEventLogConsistency()
    expect(result.counts.unknown_domain).toBe(1)
    expect(result.flags.some((f) => f.message.includes("unknown domain: 'unknown_xyz'"))).toBe(true)
  })

  it('does NOT flag any of the eight known domains', async () => {
    const knownDomains = [
      'commerce',
      'knowledge',
      'safety',
      'orchestrator',
      'health',
      'pageprofit',
      'system',
      'ollama',
    ]
    const rows = knownDomains.map((domain) => makeEventRow({ domain }))
    mockFrom.mockReturnValue(makeSelectBuilder(rows))
    const result = await checkEventLogConsistency()
    expect(result.counts.unknown_domain).toBe(0)
  })

  it('flags a typo domain (guards against neutering the check by over-expanding the list)', async () => {
    // 'commrce' is a typo of 'commerce' — must still be caught
    mockFrom.mockReturnValue(makeSelectBuilder([makeEventRow({ domain: 'commrce' })]))
    const result = await checkEventLogConsistency()
    expect(result.counts.unknown_domain).toBe(1)
    expect(result.flags.some((f) => f.message.includes("unknown domain: 'commrce'"))).toBe(true)
  })

  it('returns fail with critical flag on db query error', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([], { message: 'query failed' }))
    const result = await checkEventLogConsistency()
    expect(result.status).toBe('fail')
    expect(result.flags.some((f) => f.severity === 'critical')).toBe(true)
  })

  it('never throws even when supabase throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('crash')
    })
    await expect(checkEventLogConsistency()).resolves.toBeDefined()
  })

  it('attaches entity_id to stuck-processing flag', async () => {
    const stuckAt = new Date(FAKE_NOW - 10 * 60 * 1000).toISOString()
    const row = makeEventRow({ status: 'processing', occurred_at: stuckAt })
    mockFrom.mockReturnValue(makeSelectBuilder([row]))
    const result = await checkEventLogConsistency()
    const flag = result.flags.find((f) => f.message.includes('stuck'))
    expect(flag!.entity_id).toBe(row.id)
  })
})
