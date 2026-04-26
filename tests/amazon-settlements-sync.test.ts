import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FinancialEventGroup } from '@/lib/amazon/finances'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockFetchGroups } = vi.hoisted(() => ({
  mockFetchGroups: vi.fn(),
}))

vi.mock('@/lib/amazon/finances', () => ({
  fetchAllFinancialEventGroups: mockFetchGroups,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeOpenGroup(overrides: Partial<FinancialEventGroup> = {}): FinancialEventGroup {
  return {
    FinancialEventGroupId: 'FEG-OPEN-001',
    FinancialEventGroupStart: '2026-04-01T00:00:00Z',
    // FinancialEventGroupEnd absent (open group)
    // FundTransferStatus absent (open group)
    OriginalTotal: { CurrencyCode: 'CAD', CurrencyAmount: 1234.56 },
    ...overrides,
  }
}

function makeClosedGroup(overrides: Partial<FinancialEventGroup> = {}): FinancialEventGroup {
  return {
    FinancialEventGroupId: 'FEG-CLOSED-001',
    FinancialEventGroupStart: '2026-03-15T00:00:00Z',
    FinancialEventGroupEnd: '2026-03-29T00:00:00Z',
    FundTransferStatus: 'Transferred',
    FundTransferDate: '2026-03-30T00:00:00Z',
    OriginalTotal: { CurrencyCode: 'CAD', CurrencyAmount: 2500.0 },
    ...overrides,
  }
}

function makeNonCadGroup(): FinancialEventGroup {
  return {
    FinancialEventGroupId: 'FEG-MXN-001',
    FinancialEventGroupStart: '2026-04-01T00:00:00Z',
    OriginalTotal: { CurrencyCode: 'MXN', CurrencyAmount: 0 },
  }
}

// ── 1. mapSettlementGroupToRow — pure function ────────────────────────────────

describe('mapSettlementGroupToRow', () => {
  it('open group: fund_transfer_status=null, period_end_at=null', async () => {
    const { mapSettlementGroupToRow } = await import('@/lib/amazon/settlements-sync')
    const row = mapSettlementGroupToRow(makeOpenGroup())

    expect(row.id).toBe('FEG-OPEN-001')
    expect(row.fund_transfer_status).toBeNull()
    expect(row.period_end_at).toBeNull()
    expect(row.period_start_at).toBe('2026-04-01T00:00:00Z')
    expect(row.currency).toBe('CAD')
    expect(row.net_payout).toBe(1234.56)
  })

  it('closed group: fund_transfer_status=Transferred, period_end_at set', async () => {
    const { mapSettlementGroupToRow } = await import('@/lib/amazon/settlements-sync')
    const row = mapSettlementGroupToRow(makeClosedGroup())

    expect(row.fund_transfer_status).toBe('Transferred')
    expect(row.period_end_at).toBe('2026-03-29T00:00:00Z')
    expect(row.net_payout).toBe(2500.0)
  })

  it('gross, fees_total, refunds_total are always null (deferred)', async () => {
    const { mapSettlementGroupToRow } = await import('@/lib/amazon/settlements-sync')
    const row = mapSettlementGroupToRow(makeClosedGroup())

    expect(row.gross).toBeNull()
    expect(row.fees_total).toBeNull()
    expect(row.refunds_total).toBeNull()
  })

  it('net_payout rounds to 2 decimal places', async () => {
    const { mapSettlementGroupToRow } = await import('@/lib/amazon/settlements-sync')
    const group = makeOpenGroup({
      OriginalTotal: { CurrencyCode: 'CAD', CurrencyAmount: 100.333 },
    })
    const row = mapSettlementGroupToRow(group)
    expect(row.net_payout).toBe(100.33)
  })

  it('null OriginalTotal → net_payout=null, currency=CAD default', async () => {
    const { mapSettlementGroupToRow } = await import('@/lib/amazon/settlements-sync')
    const group: FinancialEventGroup = {
      FinancialEventGroupId: 'FEG-NULL',
    }
    const row = mapSettlementGroupToRow(group)
    expect(row.net_payout).toBeNull()
    expect(row.currency).toBe('CAD')
  })

  it('raw_json contains the original group object', async () => {
    const { mapSettlementGroupToRow } = await import('@/lib/amazon/settlements-sync')
    const group = makeClosedGroup()
    const row = mapSettlementGroupToRow(group)
    expect((row.raw_json as unknown as FinancialEventGroup).FinancialEventGroupId).toBe(
      group.FinancialEventGroupId
    )
    expect((row.raw_json as unknown as FinancialEventGroup).FundTransferStatus).toBe('Transferred')
  })

  it('updated_at is a valid ISO timestamp', async () => {
    const { mapSettlementGroupToRow } = await import('@/lib/amazon/settlements-sync')
    const before = new Date().toISOString()
    const row = mapSettlementGroupToRow(makeOpenGroup())
    const after = new Date().toISOString()
    expect(row.updated_at >= before).toBe(true)
    expect(row.updated_at <= after).toBe(true)
  })
})

// ── 2. syncSettlementsForRange ────────────────────────────────────────────────

describe('syncSettlementsForRange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  function makeDb(upsertResult: { error: null | { message: string } } = { error: null }) {
    const upsert = vi.fn().mockResolvedValue(upsertResult)
    return {
      from: vi.fn().mockReturnValue({ upsert }),
      _upsert: upsert,
    }
  }

  it('empty group list → all counts zero, no upsert', async () => {
    mockFetchGroups.mockResolvedValueOnce([])
    const db = makeDb()
    const { syncSettlementsForRange } = await import('@/lib/amazon/settlements-sync')
    const result = await syncSettlementsForRange({
      supabase: db as never,
    })
    expect(result).toEqual({ fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 })
    expect(db._upsert).not.toHaveBeenCalled()
  })

  it('non-CAD groups are skipped: fetched=total, skipped=non-CAD count', async () => {
    mockFetchGroups.mockResolvedValueOnce([makeOpenGroup(), makeNonCadGroup()])
    const db = makeDb()
    const { syncSettlementsForRange } = await import('@/lib/amazon/settlements-sync')
    const result = await syncSettlementsForRange({ supabase: db as never })

    expect(result.fetched).toBe(2) // total groups from SP-API
    expect(result.skipped).toBe(1) // MXN group filtered out
    expect(result.inserted).toBe(1) // CAD group upserted
    expect(result.errors).toBe(0)
  })

  it('all-CAD groups: fetched=N, inserted=N, skipped=0', async () => {
    mockFetchGroups.mockResolvedValueOnce([makeOpenGroup(), makeClosedGroup()])
    const db = makeDb()
    const { syncSettlementsForRange } = await import('@/lib/amazon/settlements-sync')
    const result = await syncSettlementsForRange({ supabase: db as never })

    expect(result.fetched).toBe(2)
    expect(result.inserted).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.errors).toBe(0)
    expect(db._upsert).toHaveBeenCalledTimes(2)
  })

  it('dry-run: fetches and counts CAD groups but never upserts', async () => {
    mockFetchGroups.mockResolvedValueOnce([makeOpenGroup(), makeClosedGroup()])
    const db = makeDb()
    const { syncSettlementsForRange } = await import('@/lib/amazon/settlements-sync')
    const result = await syncSettlementsForRange({ supabase: db as never, dryRun: true })

    expect(result.fetched).toBe(2)
    expect(result.inserted).toBe(2) // dry-run still counts as "would insert"
    expect(db._upsert).not.toHaveBeenCalled()
  })

  it('DB error on one group: error counted, other groups still upserted', async () => {
    mockFetchGroups.mockResolvedValueOnce([
      makeOpenGroup({ FinancialEventGroupId: 'FEG-GOOD' }),
      makeClosedGroup({ FinancialEventGroupId: 'FEG-BAD' }),
    ])

    let callCount = 0
    const upsert = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ error: null }) // FEG-GOOD succeeds
      return Promise.resolve({ error: { message: 'DB constraint violation' } }) // FEG-BAD fails
    })
    const db = { from: vi.fn().mockReturnValue({ upsert }) }

    const { syncSettlementsForRange } = await import('@/lib/amazon/settlements-sync')
    const result = await syncSettlementsForRange({ supabase: db as never })

    expect(result.inserted).toBe(1)
    expect(result.errors).toBe(1)
    expect(result.fetched).toBe(2)
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('DB upsert throws (429 / network error): error counted, remaining groups processed', async () => {
    mockFetchGroups.mockResolvedValueOnce([
      makeOpenGroup({ FinancialEventGroupId: 'FEG-THROW' }),
      makeClosedGroup({ FinancialEventGroupId: 'FEG-OK' }),
    ])

    let callCount = 0
    const upsert = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) throw new Error('ETIMEDOUT') // simulates 429 / network error
      return Promise.resolve({ error: null })
    })
    const db = { from: vi.fn().mockReturnValue({ upsert }) }

    const { syncSettlementsForRange } = await import('@/lib/amazon/settlements-sync')
    const result = await syncSettlementsForRange({ supabase: db as never })

    // FEG-THROW throws → errors+1; FEG-OK succeeds → inserted+1; sync continues
    expect(result.errors).toBe(1)
    expect(result.inserted).toBe(1)
    expect(result.fetched).toBe(2)
  })

  it('fetchAllFinancialEventGroups throws → error propagates to caller', async () => {
    mockFetchGroups.mockRejectedValueOnce(new Error('SP-API 429: rate limited'))
    const db = makeDb()
    const { syncSettlementsForRange } = await import('@/lib/amazon/settlements-sync')

    await expect(syncSettlementsForRange({ supabase: db as never })).rejects.toThrow(
      'SP-API 429: rate limited'
    )
    expect(db._upsert).not.toHaveBeenCalled()
  })

  it('uses daysBack=35 default when not specified', async () => {
    mockFetchGroups.mockResolvedValueOnce([])
    const db = makeDb()
    const { syncSettlementsForRange } = await import('@/lib/amazon/settlements-sync')
    await syncSettlementsForRange({ supabase: db as never })

    expect(mockFetchGroups).toHaveBeenCalledWith(35)
  })

  it('passes custom daysBack to fetchAllFinancialEventGroups', async () => {
    mockFetchGroups.mockResolvedValueOnce([])
    const db = makeDb()
    const { syncSettlementsForRange } = await import('@/lib/amazon/settlements-sync')
    await syncSettlementsForRange({ supabase: db as never, daysBack: 90 })

    expect(mockFetchGroups).toHaveBeenCalledWith(90)
  })

  it('upserts on id conflict (onConflict=id passed to Supabase)', async () => {
    mockFetchGroups.mockResolvedValueOnce([makeOpenGroup()])
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const db = { from: vi.fn().mockReturnValue({ upsert }) }

    const { syncSettlementsForRange } = await import('@/lib/amazon/settlements-sync')
    await syncSettlementsForRange({ supabase: db as never })

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'FEG-OPEN-001' }), {
      onConflict: 'id',
    })
  })
})
