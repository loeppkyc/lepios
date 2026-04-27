import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { buildUtilityBillSavedLine } from '@/lib/harness/utility-digest'

function makeSelectChain(data: unknown[]) {
  const result = { data, error: null }
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

describe('buildUtilityBillSavedLine', () => {
  it('returns count=0 when no events in last 24h', async () => {
    mockFrom.mockReturnValue(makeSelectChain([]))
    const line = await buildUtilityBillSavedLine()
    expect(line).toBe('Utility bills saved (24h): 0')
  })

  it('returns correct count when events exist', async () => {
    mockFrom.mockReturnValue(makeSelectChain([{ id: 'a' }, { id: 'b' }, { id: 'c' }]))
    const line = await buildUtilityBillSavedLine()
    expect(line).toBe('Utility bills saved (24h): 3')
  })

  it('queries agent_events with action=utility_bill_saved', async () => {
    const chain = makeSelectChain([])
    mockFrom.mockReturnValue(chain)
    await buildUtilityBillSavedLine()
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const eqCall = (chain.eq as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'action'
    )
    expect(eqCall?.[1]).toBe('utility_bill_saved')
  })

  it('returns unavailable line on DB error', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('connection refused')
    })
    const line = await buildUtilityBillSavedLine()
    expect(line).toBe('Utility bills saved (24h): unavailable')
  })
})
