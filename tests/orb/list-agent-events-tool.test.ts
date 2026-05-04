/**
 * Unit tests for listAgentEventsTool.
 * Covers: default params, action filter, status filter, empty result, DB error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { listAgentEventsTool } from '@/lib/orb/tools/list-agent-events'

function makeQueryBuilder(
  rows: unknown[],
  error: Error | null = null,
) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  }
  // resolve on the last chained call (limit or eq)
  const resolved = Promise.resolve({ data: rows, error })
  ;(builder.limit as ReturnType<typeof vi.fn>).mockReturnValue({
    ...builder,
    eq: vi.fn().mockResolvedValue({ data: rows, error }),
    then: resolved.then.bind(resolved),
  })
  return builder
}

const sampleEvent = {
  id: 'evt-1',
  occurred_at: '2026-05-03T10:00:00Z',
  domain: 'harness',
  action: 'smoke_test_passed',
  actor: 'route-health',
  status: 'success',
  error_message: null,
  duration_ms: 320,
  meta: { routes: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listAgentEventsTool metadata', () => {
  it('has correct name and capability', () => {
    expect(listAgentEventsTool.name).toBe('listAgentEvents')
    expect(listAgentEventsTool.capability).toBe('tool.chat_ui.read.agent_events')
  })
})

describe('listAgentEventsTool execute', () => {
  it('returns events and count with default params', async () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [sampleEvent], error: null }),
    }
    mockFrom.mockReturnValueOnce(builder)

    const result = await listAgentEventsTool.execute({}, {} as never)
    expect(result.count).toBe(1)
    expect(result.events[0].action).toBe('smoke_test_passed')
  })

  it('returns empty array when no rows match', async () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    mockFrom.mockReturnValueOnce(builder)

    const result = await listAgentEventsTool.execute({ limit: 5 }, {} as never)
    expect(result.count).toBe(0)
    expect(result.events).toHaveLength(0)
  })

  it('applies action and status filters when provided', async () => {
    const eqMock = vi.fn().mockReturnThis()
    const finalEqMock = vi.fn().mockResolvedValue({ data: [sampleEvent], error: null })
    const builder = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue({ eq: eqMock.mockReturnValue({ eq: finalEqMock }) }),
    }
    mockFrom.mockReturnValueOnce(builder)

    const result = await listAgentEventsTool.execute(
      { action: 'smoke_test_passed', status: 'success' },
      {} as never,
    )
    expect(result.count).toBe(1)
  })

  it('throws on DB error', async () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: new Error('query failed') }),
    }
    mockFrom.mockReturnValueOnce(builder)

    await expect(listAgentEventsTool.execute({}, {} as never)).rejects.toThrow('query failed')
  })
})
