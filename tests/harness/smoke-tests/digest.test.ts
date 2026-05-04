import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { buildDeploySmokeStatsLine } from '@/lib/harness/smoke-tests/digest'

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

describe('buildDeploySmokeStatsLine', () => {
  it('AC-1: no events in last 24h → "Smoke: no deploys in last 24h"', async () => {
    mockFrom.mockReturnValue(makeSelectChain({ data: [], error: null }))
    const line = await buildDeploySmokeStatsLine()
    expect(line).toBe('Smoke: no deploys in last 24h')
  })

  it('AC-2: all passed → "Deploys (24h): 2 | smoke: 2/2 ✓"', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain({ data: [{ status: 'success' }, { status: 'success' }], error: null })
    )
    const line = await buildDeploySmokeStatsLine()
    expect(line).toBe('Deploys (24h): 2 | smoke: 2/2 ✓')
  })

  it('AC-3: one failed → "Deploys (24h): 3 | smoke: 2/3 — 1 FAILED"', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain({
        data: [{ status: 'success' }, { status: 'success' }, { status: 'error' }],
        error: null,
      })
    )
    const line = await buildDeploySmokeStatsLine()
    expect(line).toBe('Deploys (24h): 3 | smoke: 2/3 — 1 FAILED')
  })

  it('AC-4: all failed → "Deploys (24h): 1 | smoke: 0/1 — 1 FAILED"', async () => {
    mockFrom.mockReturnValue(makeSelectChain({ data: [{ status: 'error' }], error: null }))
    const line = await buildDeploySmokeStatsLine()
    expect(line).toBe('Deploys (24h): 1 | smoke: 0/1 — 1 FAILED')
  })

  it('AC-5: DB error → "Smoke: stats unavailable"', async () => {
    mockFrom.mockReturnValue(makeSelectChain({ data: null, error: new Error('db down') }))
    const line = await buildDeploySmokeStatsLine()
    expect(line).toBe('Smoke: stats unavailable')
  })

  it('AC-6: createServiceClient throws → "Smoke: stats unavailable"', async () => {
    const { createServiceClient } = await import('@/lib/supabase/service')
    vi.mocked(createServiceClient).mockImplementationOnce(() => {
      throw new Error('client failed')
    })
    const line = await buildDeploySmokeStatsLine()
    expect(line).toBe('Smoke: stats unavailable')
  })
})
