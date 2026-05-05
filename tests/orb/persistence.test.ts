/**
 * Unit tests for lib/orb/persistence.ts.
 *
 * Focus: listConversations() filter — orphan conversations (failed sends
 * that left a 1-msg row) must not appear in the sidebar list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { listConversations } from '@/lib/orb/persistence'

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'is', 'gte', 'order', 'limit']
  const self = () => chain
  for (const m of methods) chain[m] = vi.fn(self)
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listConversations — orphan-conv filter', () => {
  it('applies .gte("message_count", 2) to hide 1-msg orphans', async () => {
    const chain = makeChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain)

    await listConversations('user-123')

    expect(mockFrom).toHaveBeenCalledWith('conversations')
    expect(chain.gte).toHaveBeenCalledWith('message_count', 2)
  })

  it('still filters by user_id and excludes archived rows', async () => {
    const chain = makeChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain)

    await listConversations('user-123')

    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-123')
    expect(chain.is).toHaveBeenCalledWith('archived_at', null)
  })

  it('returns the rows the DB returned (no client-side filter dependency)', async () => {
    const rows = [
      {
        id: 'c1',
        user_id: 'user-123',
        title: 'Real conv',
        message_count: 4,
        created_at: '2026-05-05T00:00:00Z',
        updated_at: '2026-05-05T00:00:00Z',
        archived_at: null,
      },
    ]
    mockFrom.mockReturnValue(makeChain({ data: rows, error: null }))

    const result = await listConversations('user-123')

    expect(result).toEqual(rows)
  })

  it('throws on DB error', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: new Error('boom') }))
    await expect(listConversations('user-123')).rejects.toThrow('boom')
  })
})
