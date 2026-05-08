/**
 * Tests for lib/failures/list.ts (listFailures).
 *
 * Mocks the Supabase service client. Validates filter passthrough + sort
 * order: open+recurring first, then severity DESC, then last_seen_at DESC.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { listFailures } from '@/lib/failures/list'

beforeEach(() => mockFrom.mockReset())

type Row = {
  id: string
  failure_number: string | null
  title: string
  trigger_context: string
  severity: string
  status: string
  occurrence_count: number
  last_seen_at: string
  fix_commit_sha: string | null
  lesson: string | null
  what_happened: string
  root_cause: string | null
  pattern_signature: Record<string, unknown>
}

function row(overrides: Partial<Row>): Row {
  return {
    id: 'uuid',
    failure_number: null,
    title: 'T',
    trigger_context: 'manual',
    severity: 'medium',
    status: 'open',
    occurrence_count: 1,
    last_seen_at: '2026-05-08T10:00:00Z',
    fix_commit_sha: null,
    lesson: null,
    what_happened: 'W',
    root_cause: null,
    pattern_signature: {},
    ...overrides,
  }
}

function makeBuilder(rows: Row[], expectFilters: { eqCalls: number }) {
  let eqCount = 0
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.order = () => builder
  builder.limit = () => Promise.resolve({ data: rows, error: null })
  builder.eq = () => {
    eqCount++
    expectFilters.eqCalls = eqCount
    return builder
  }
  return builder
}

describe('listFailures — sort', () => {
  it('puts recurring before open before fixing before fixed', async () => {
    const probe = { eqCalls: 0 }
    mockFrom.mockReturnValueOnce(
      makeBuilder(
        [
          row({ id: 'a', status: 'fixed', severity: 'high', last_seen_at: '2026-05-08T10:00:00Z' }),
          row({ id: 'b', status: 'open', severity: 'low', last_seen_at: '2026-05-01T10:00:00Z' }),
          row({
            id: 'c',
            status: 'recurring',
            severity: 'low',
            last_seen_at: '2026-05-01T10:00:00Z',
          }),
          row({
            id: 'd',
            status: 'fixing',
            severity: 'critical',
            last_seen_at: '2026-05-08T10:00:00Z',
          }),
        ],
        probe
      )
    )
    const result = await listFailures()
    expect(result.map((r) => r.id)).toEqual(['c', 'b', 'd', 'a'])
  })

  it('within same status, sorts by severity DESC then last_seen DESC', async () => {
    const probe = { eqCalls: 0 }
    mockFrom.mockReturnValueOnce(
      makeBuilder(
        [
          row({ id: 'a', status: 'open', severity: 'low', last_seen_at: '2026-05-08T10:00:00Z' }),
          row({
            id: 'b',
            status: 'open',
            severity: 'critical',
            last_seen_at: '2026-05-01T10:00:00Z',
          }),
          row({ id: 'c', status: 'open', severity: 'high', last_seen_at: '2026-05-05T10:00:00Z' }),
          row({ id: 'd', status: 'open', severity: 'high', last_seen_at: '2026-05-07T10:00:00Z' }),
        ],
        probe
      )
    )
    const result = await listFailures()
    expect(result.map((r) => r.id)).toEqual(['b', 'd', 'c', 'a'])
  })
})

describe('listFailures — filters', () => {
  it('passes status filter to query when not "all"', async () => {
    const probe = { eqCalls: 0 }
    mockFrom.mockReturnValueOnce(makeBuilder([], probe))
    await listFailures({ status: 'open' })
    expect(probe.eqCalls).toBe(1)
  })

  it('does not apply filter for "all"', async () => {
    const probe = { eqCalls: 0 }
    mockFrom.mockReturnValueOnce(makeBuilder([], probe))
    await listFailures({ status: 'all' })
    expect(probe.eqCalls).toBe(0)
  })

  it('applies both status and severity when both provided', async () => {
    const probe = { eqCalls: 0 }
    mockFrom.mockReturnValueOnce(makeBuilder([], probe))
    await listFailures({ status: 'open', severity: 'critical' })
    expect(probe.eqCalls).toBe(2)
  })
})
