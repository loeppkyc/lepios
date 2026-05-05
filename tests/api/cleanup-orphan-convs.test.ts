/**
 * Unit tests for app/api/cron/cleanup-orphan-convs/route.ts.
 *
 * Companion to lib/orb/persistence.ts:listConversations (the sidebar-side
 * orphan filter). The cron is the DB-side cleanup pass.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { GET } from '@/app/api/cron/cleanup-orphan-convs/route'

const ORIGINAL_ENV = { ...process.env }
const VALID_SECRET = 'test-cron-secret-1234567890'

function authedRequest(): Request {
  return new Request('http://localhost/api/cron/cleanup-orphan-convs', {
    headers: { authorization: `Bearer ${VALID_SECRET}` },
  })
}

function unauthedRequest(): Request {
  return new Request('http://localhost/api/cron/cleanup-orphan-convs', {
    headers: { authorization: 'Bearer wrong' },
  })
}

/**
 * Build a delete-chain mock that captures the .lt() filter calls so the
 * tests can assert the cutoff window + message_count predicate. The chain
 * resolves to whatever `result` is when .select() is called.
 */
function makeDeleteChain(result: { data: unknown; error: unknown }) {
  const calls = { lt: [] as Array<[string, unknown]> }
  const chain: Record<string, unknown> = {}
  chain.delete = vi.fn(() => chain)
  chain.lt = vi.fn((col: string, val: unknown) => {
    calls.lt.push([col, val])
    return chain
  })
  chain.select = vi.fn(() => Promise.resolve(result))
  return { chain, calls }
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  process.env.CRON_SECRET = VALID_SECRET
  mockFrom.mockReset()
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('cleanup-orphan-convs', () => {
  it('returns 401 when unauthorized', async () => {
    const res = await GET(unauthedRequest())
    expect(res.status).toBe(401)
  })

  it('clean run: deletes orphan rows, writes success agent_events row', async () => {
    const deletedRows = [{ id: 'orphan-1' }, { id: 'orphan-2' }]
    const inserts: unknown[] = []
    const { chain, calls } = makeDeleteChain({ data: deletedRows, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'conversations') return chain
      if (table === 'agent_events') {
        return {
          insert: (row: unknown) => {
            inserts.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      return {}
    })

    const res = await GET(authedRequest())
    const body = (await res.json()) as { ok: boolean; deleted: number; cutoff: string }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.deleted).toBe(2)
    // Both filters applied: message_count < 2 AND created_at < (now - 24h)
    expect(calls.lt).toEqual([
      ['message_count', 2],
      ['created_at', expect.any(String)],
    ])
    // 24h cutoff is roughly the value we passed; sanity-check it parses as a date.
    expect(Number.isNaN(Date.parse(calls.lt[1][1] as string))).toBe(false)

    expect(inserts).toHaveLength(1)
    const ev = inserts[0] as {
      action: string
      status: string
      meta: { deleted: number; sample_ids: string[] }
    }
    expect(ev.action).toBe('cleanup_orphan_convs')
    expect(ev.status).toBe('success')
    expect(ev.meta.deleted).toBe(2)
    expect(ev.meta.sample_ids).toEqual(['orphan-1', 'orphan-2'])
  })

  it('idempotent on empty days: deleted=0 still writes success row', async () => {
    const inserts: unknown[] = []
    const { chain } = makeDeleteChain({ data: [], error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'conversations') return chain
      if (table === 'agent_events') {
        return {
          insert: (row: unknown) => {
            inserts.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      return {}
    })

    const res = await GET(authedRequest())
    const body = (await res.json()) as { ok: boolean; deleted: number }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.deleted).toBe(0)
    expect(inserts).toHaveLength(1)
    const ev = inserts[0] as { status: string; meta: { deleted: number } }
    expect(ev.status).toBe('success')
    expect(ev.meta.deleted).toBe(0)
  })

  it('caps sample_ids at 10 even when more rows are deleted', async () => {
    const deletedRows = Array.from({ length: 25 }, (_, i) => ({ id: `o-${i}` }))
    const inserts: unknown[] = []
    const { chain } = makeDeleteChain({ data: deletedRows, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'conversations') return chain
      if (table === 'agent_events') {
        return {
          insert: (row: unknown) => {
            inserts.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      return {}
    })

    await GET(authedRequest())
    const ev = inserts[0] as { meta: { deleted: number; sample_ids: string[] } }
    expect(ev.meta.deleted).toBe(25)
    expect(ev.meta.sample_ids).toHaveLength(10)
    expect(ev.meta.sample_ids[0]).toBe('o-0')
    expect(ev.meta.sample_ids[9]).toBe('o-9')
  })

  it('DB error: 500 + error agent_events row', async () => {
    const inserts: unknown[] = []
    const { chain } = makeDeleteChain({ data: null, error: { message: 'connection lost' } })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'conversations') return chain
      if (table === 'agent_events') {
        return {
          insert: (row: unknown) => {
            inserts.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      return {}
    })

    const res = await GET(authedRequest())
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('connection lost')

    expect(inserts).toHaveLength(1)
    const ev = inserts[0] as { status: string; output_summary: string }
    expect(ev.status).toBe('error')
    expect(ev.output_summary).toContain('connection lost')
  })
})
