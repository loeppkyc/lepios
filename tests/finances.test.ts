import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock spFetch before importing the module under test ───────────────────────

vi.mock('@/lib/amazon/client', () => ({
  spFetch: vi.fn(),
  spApiConfigured: vi.fn(() => true),
}))

import { fetchSettlementBalance } from '@/lib/amazon/finances'
import { spFetch } from '@/lib/amazon/client'

const mockSpFetch = vi.mocked(spFetch)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGroup(overrides: {
  id?: string
  fundTransferStatus?: string
  currencyCode?: string
  amount?: number
}) {
  const group: Record<string, unknown> = {
    FinancialEventGroupId: overrides.id ?? 'FEG-001',
    OriginalTotal: {
      CurrencyCode: overrides.currencyCode ?? 'CAD',
      CurrencyAmount: overrides.amount ?? 0,
    },
  }
  if (overrides.fundTransferStatus !== undefined) {
    group.FundTransferStatus = overrides.fundTransferStatus
  }
  return group
}

function makeResponse(groups: ReturnType<typeof makeGroup>[], nextToken?: string) {
  return {
    payload: {
      FinancialEventGroupList: groups,
      ...(nextToken ? { NextToken: nextToken } : {}),
    },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fetchSettlementBalance', () => {
  beforeEach(() => {
    mockSpFetch.mockReset()
  })

  it('sums OriginalTotal.CurrencyAmount for open CAD groups only', async () => {
    // open CAD group (no FundTransferStatus field)
    const openCad = makeGroup({ id: 'FEG-001', amount: 928.17, currencyCode: 'CAD' })
    // closed CAD group (FundTransferStatus present)
    const closedCad = makeGroup({ id: 'FEG-002', fundTransferStatus: 'Transferred', amount: 500.0, currencyCode: 'CAD' })
    // open MXN group (must be excluded — Constraint B-2)
    const openMxn = makeGroup({ id: 'FEG-003', amount: 0, currencyCode: 'MXN' })

    mockSpFetch.mockResolvedValueOnce(makeResponse([openCad, closedCad, openMxn]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(928.17)
  })

  it('excludes closed groups (FundTransferStatus = "Transferred")', async () => {
    const closed = makeGroup({ id: 'FEG-C', fundTransferStatus: 'Transferred', amount: 1000.0 })
    mockSpFetch.mockResolvedValueOnce(makeResponse([closed]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
  })

  it('excludes open MXN groups (Constraint B-2)', async () => {
    const openMxn = makeGroup({ id: 'FEG-MX', amount: 100.0, currencyCode: 'MXN' })
    mockSpFetch.mockResolvedValueOnce(makeResponse([openMxn]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
  })

  it('returns 0 when all groups are closed', async () => {
    const g1 = makeGroup({ id: 'FEG-X', fundTransferStatus: 'Transferred', amount: 200.0 })
    const g2 = makeGroup({ id: 'FEG-Y', fundTransferStatus: 'Transferred', amount: 350.0 })
    mockSpFetch.mockResolvedValueOnce(makeResponse([g1, g2]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
  })

  it('returns 0 on empty group list', async () => {
    mockSpFetch.mockResolvedValueOnce(makeResponse([]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
  })

  it('sums multiple open CAD groups', async () => {
    const g1 = makeGroup({ id: 'FEG-1', amount: 100.0, currencyCode: 'CAD' })
    const g2 = makeGroup({ id: 'FEG-2', amount: 250.5, currencyCode: 'CAD' })
    const g3 = makeGroup({ id: 'FEG-3', amount: 75.25, currencyCode: 'CAD' })
    mockSpFetch.mockResolvedValueOnce(makeResponse([g1, g2, g3]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(425.75)
  })

  it('rounds to 2 decimal places', async () => {
    const g1 = makeGroup({ id: 'FEG-1', amount: 10.333 })
    const g2 = makeGroup({ id: 'FEG-2', amount: 5.666 })
    mockSpFetch.mockResolvedValueOnce(makeResponse([g1, g2]))

    const result = await fetchSettlementBalance()
    // 10.333 + 5.666 = 15.999 → 16.00
    expect(result.grossPendingCad).toBe(16.0)
  })

  it('follows pagination — accumulates across pages', async () => {
    const g1 = makeGroup({ id: 'FEG-P1', amount: 100.0 })
    const g2 = makeGroup({ id: 'FEG-P2', amount: 200.0 })

    mockSpFetch
      .mockResolvedValueOnce(makeResponse([g1], 'TOKEN-1'))
      .mockResolvedValueOnce(makeResponse([g2]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(300.0)
    expect(mockSpFetch).toHaveBeenCalledTimes(2)
  })

  it('returns fetchedAt as a valid ISO timestamp', async () => {
    mockSpFetch.mockResolvedValueOnce(makeResponse([]))

    const before = new Date().toISOString()
    const result = await fetchSettlementBalance()
    const after = new Date().toISOString()

    expect(result.fetchedAt >= before).toBe(true)
    expect(result.fetchedAt <= after).toBe(true)
  })

  it('treats group with FundTransferStatus = undefined as open', async () => {
    // Explicit undefined on the field — same as absent per B-1
    const group = {
      FinancialEventGroupId: 'FEG-U',
      FundTransferStatus: undefined,
      OriginalTotal: { CurrencyCode: 'CAD', CurrencyAmount: 99.99 },
    }
    mockSpFetch.mockResolvedValueOnce({ payload: { FinancialEventGroupList: [group] } })

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(99.99)
  })

  it('includes groups with FundTransferStatus = null (SP-API returns null for pending transfer)', async () => {
    const group = {
      FinancialEventGroupId: 'FEG-NULL',
      FundTransferStatus: null,
      OriginalTotal: { CurrencyCode: 'CAD', CurrencyAmount: 5327.12 },
    }
    mockSpFetch.mockResolvedValueOnce({ payload: { FinancialEventGroupList: [group] } })

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(5327.12)
  })

  it('includes groups with FundTransferStatus = "Initiated" (transfer in-flight)', async () => {
    const group = makeGroup({ id: 'FEG-INIT', fundTransferStatus: 'Initiated', amount: 4000.0 })
    mockSpFetch.mockResolvedValueOnce(makeResponse([group]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(4000.0)
  })

  it('excludes groups with FundTransferStatus = "Successful"', async () => {
    const group = makeGroup({ id: 'FEG-OK', fundTransferStatus: 'Successful', amount: 999.0 })
    mockSpFetch.mockResolvedValueOnce(makeResponse([group]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
  })

  it('sums open + in-flight groups, excludes paid-out groups', async () => {
    const open = makeGroup({ id: 'FEG-OPEN', amount: 1052.46 })
    const inFlight = makeGroup({ id: 'FEG-FLY', fundTransferStatus: 'Initiated', amount: 5327.12 })
    const paidOut = makeGroup({ id: 'FEG-DONE', fundTransferStatus: 'Transferred', amount: 800.0 })
    mockSpFetch.mockResolvedValueOnce(makeResponse([open, inFlight, paidOut]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(6379.58)
  })
})
