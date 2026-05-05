import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { buildOpenEscalationsLine } from '@/lib/harness/twin-escalations/digest'

function makeSelectChain(result: { data: unknown[] | null; error: unknown }) {
  const chain: Record<string, unknown> = {
    then: (
      fn: Parameters<Promise<unknown>['then']>[0],
      rej?: Parameters<Promise<unknown>['then']>[1]
    ) => Promise.resolve(result).then(fn, rej),
    catch: (fn: Parameters<Promise<unknown>['catch']>[0]) => Promise.resolve(result).catch(fn),
    finally: (fn: Parameters<Promise<unknown>['finally']>[0]) =>
      Promise.resolve(result).finally(fn),
  }
  for (const m of ['select', 'eq', 'gte', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildOpenEscalationsLine', () => {
  it('AC-1: 0 open in last 24h → "Twin escalations (24h): 0 open"', async () => {
    mockFrom.mockReturnValue(makeSelectChain({ data: [], error: null }))
    const line = await buildOpenEscalationsLine()
    expect(line).toBe('Twin escalations (24h): 0 open')
  })

  it('AC-2: 3 open → "Twin escalations (24h): 3 open — teach via /api/twin/teach with escalation_id"', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null })
    )
    const line = await buildOpenEscalationsLine()
    expect(line).toBe(
      'Twin escalations (24h): 3 open — teach via /api/twin/teach with escalation_id'
    )
  })

  it('AC-3: DB error → "Twin escalations: stats unavailable"', async () => {
    mockFrom.mockReturnValue(makeSelectChain({ data: null, error: new Error('db down') }))
    const line = await buildOpenEscalationsLine()
    expect(line).toBe('Twin escalations: stats unavailable')
  })

  it('AC-4: createServiceClient throws → "Twin escalations: stats unavailable"', async () => {
    const { createServiceClient } = await import('@/lib/supabase/service')
    vi.mocked(createServiceClient).mockImplementationOnce(() => {
      throw new Error('client failed')
    })
    const line = await buildOpenEscalationsLine()
    expect(line).toBe('Twin escalations: stats unavailable')
  })
})
