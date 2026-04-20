import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { checkScanIntegrity } from '@/lib/orchestrator/checks/scan-integrity'

let rowCounter = 0
function makeScanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `scan-${++rowCounter}`,
    asin: 'B001234567',
    isbn: '9780123456789',
    profit_cad: 5.0,
    cost_paid_cad: 2.0,
    recorded_at: '2026-04-19T10:00:00.000Z',
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
  rowCounter = 0
})

describe('checkScanIntegrity', () => {
  it('returns pass with no flags when all rows are clean', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([makeScanRow()]))
    const result = await checkScanIntegrity()
    expect(result.name).toBe('scan_integrity')
    expect(result.status).toBe('pass')
    expect(result.flags).toHaveLength(0)
    expect(result.counts.total).toBe(1)
  })

  it('returns pass with zero rows (no scans yesterday)', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([]))
    const result = await checkScanIntegrity()
    expect(result.status).toBe('pass')
    expect(result.counts.total).toBe(0)
  })

  it('flags missing asin', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([makeScanRow({ asin: null })]))
    const result = await checkScanIntegrity()
    expect(result.counts.missing_asin).toBe(1)
    expect(result.flags.some((f) => f.message.includes('missing asin'))).toBe(true)
    expect(result.status).toBe('warn')
  })

  it('flags null profit_cad', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([makeScanRow({ profit_cad: null })]))
    const result = await checkScanIntegrity()
    expect(result.counts.null_profit).toBe(1)
    expect(result.flags.some((f) => f.message.includes('null profit_cad'))).toBe(true)
    expect(result.status).toBe('warn')
  })

  it('flags negative cost_paid_cad', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([makeScanRow({ cost_paid_cad: -1.0 })]))
    const result = await checkScanIntegrity()
    expect(result.counts.negative_cost).toBe(1)
    expect(result.flags.some((f) => f.message.includes('negative cost_paid_cad'))).toBe(true)
    expect(result.status).toBe('warn')
  })

  it('flags duplicate isbn within 60 seconds', async () => {
    const isbn = '9780111111111'
    const row1 = makeScanRow({ isbn, recorded_at: '2026-04-19T10:00:00.000Z' })
    const row2 = makeScanRow({ isbn, recorded_at: '2026-04-19T10:00:30.000Z' }) // 30s gap
    mockFrom.mockReturnValue(makeSelectBuilder([row1, row2]))
    const result = await checkScanIntegrity()
    expect(result.counts.duplicate_isbn).toBeGreaterThanOrEqual(1)
    expect(result.flags.some((f) => f.message.includes('duplicate isbn'))).toBe(true)
  })

  it('does NOT flag duplicate isbn more than 60 seconds apart', async () => {
    const isbn = '9780222222222'
    const row1 = makeScanRow({ isbn, recorded_at: '2026-04-19T10:00:00.000Z' })
    const row2 = makeScanRow({ isbn, recorded_at: '2026-04-19T10:02:00.000Z' }) // 120s gap
    mockFrom.mockReturnValue(makeSelectBuilder([row1, row2]))
    const result = await checkScanIntegrity()
    expect(result.counts.duplicate_isbn).toBe(0)
  })

  it('returns fail status on db query error', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([], { message: 'db error' }))
    const result = await checkScanIntegrity()
    expect(result.status).toBe('fail')
    expect(result.flags.some((f) => f.severity === 'critical')).toBe(true)
  })

  it('multiple flags on same row each increment their own counter', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([makeScanRow({ asin: null, profit_cad: null })]))
    const result = await checkScanIntegrity()
    expect(result.counts.missing_asin).toBe(1)
    expect(result.counts.null_profit).toBe(1)
  })

  it('never throws even when supabase throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('crash')
    })
    await expect(checkScanIntegrity()).resolves.toBeDefined()
  })

  it('attaches entity_id to flags', async () => {
    const row = makeScanRow({ asin: null })
    mockFrom.mockReturnValue(makeSelectBuilder([row]))
    const result = await checkScanIntegrity()
    const flag = result.flags.find((f) => f.message.includes('missing asin'))
    expect(flag!.entity_id).toBe(row.id)
  })
})
