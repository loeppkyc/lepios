/**
 * Unit tests for queryDbTool.
 * Covers: returns rows, applies filters, respects limit cap, handles DB error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { queryDbTool } from '@/lib/orb/tools/query-db'

/**
 * Builds a chainable Supabase query builder stub.
 * Resolves with { data, error } on the final .limit() call.
 */
function makeBuilder(rows: unknown[], error: { message: string } | null = null) {
  const resolved = Promise.resolve({ data: rows, error })
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue(resolved),
  }
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('queryDbTool metadata', () => {
  it('has correct name and capability', () => {
    expect(queryDbTool.name).toBe('queryDb')
    expect(queryDbTool.capability).toBe('tool.chat_ui.read.db')
  })
})

describe('queryDbTool execute', () => {
  it('returns rows and count for an allowed table', async () => {
    const rows = [{ id: '1', slug: 'smoke_test', pct: 100 }]
    mockFrom.mockReturnValueOnce(makeBuilder(rows))

    const result = await queryDbTool.execute(
      { table: 'harness_components', limit: 10 },
      {} as never
    )

    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.table).toBe('harness_components')
      expect(result.count).toBe(1)
      expect(result.rows).toEqual(rows)
    }
  })

  it('applies equality filters when provided', async () => {
    const rows = [{ id: '2', status: 'success' }]
    const builder = makeBuilder(rows)
    mockFrom.mockReturnValueOnce(builder)

    await queryDbTool.execute(
      { table: 'agent_events', filters: { status: 'success', domain: 'harness' }, limit: 5 },
      {} as never
    )

    expect(builder.eq).toHaveBeenCalledWith('status', 'success')
    expect(builder.eq).toHaveBeenCalledWith('domain', 'harness')
  })

  it('applies order_by when provided', async () => {
    const builder = makeBuilder([])
    mockFrom.mockReturnValueOnce(builder)

    await queryDbTool.execute(
      { table: 'task_queue', order_by: 'created_at', limit: 3 },
      {} as never
    )

    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('defaults limit to 10 when not specified', async () => {
    const builder = makeBuilder([])
    mockFrom.mockReturnValueOnce(builder)

    await queryDbTool.execute({ table: 'harness_config' }, {} as never)

    expect(builder.limit).toHaveBeenCalledWith(10)
  })

  it('returns empty rows array when table has no matching rows', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder([]))

    const result = await queryDbTool.execute({ table: 'expenses', limit: 5 }, {} as never)

    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.count).toBe(0)
      expect(result.rows).toHaveLength(0)
    }
  })

  it('returns query_error on DB failure', async () => {
    const builder = makeBuilder([], { message: 'relation does not exist' })
    mockFrom.mockReturnValueOnce(builder)

    const result = await queryDbTool.execute({ table: 'knowledge', limit: 10 }, {} as never)

    expect(result).toMatchObject({ error: 'query_error' })
    if ('error' in result && result.error === 'query_error') {
      expect(result.message).toContain('relation does not exist')
    }
  })

  it('handles null data response gracefully', async () => {
    const resolved = Promise.resolve({ data: null, error: null })
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue(resolved),
    }
    mockFrom.mockReturnValueOnce(builder)

    const result = await queryDbTool.execute({ table: 'mileage_trips', limit: 10 }, {} as never)

    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.rows).toEqual([])
      expect(result.count).toBe(0)
    }
  })
})
