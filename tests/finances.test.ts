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
  processingStatus?: string
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
  if (overrides.processingStatus !== undefined) {
    group.ProcessingStatus = overrides.processingStatus
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
    // open CAD group (ProcessingStatus=Open, no FundTransferStatus)
    const openCad = makeGroup({
      id: 'FEG-001',
      processingStatus: 'Open',
      amount: 928.17,
      currencyCode: 'CAD',
    })
    // closed CAD group (FundTransferStatus present — excluded)
    const closedCad = makeGroup({
      id: 'FEG-002',
      fundTransferStatus: 'Transferred',
      amount: 500.0,
      currencyCode: 'CAD',
    })
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
    const g1 = makeGroup({
      id: 'FEG-1',
      processingStatus: 'Open',
      amount: 100.0,
      currencyCode: 'CAD',
    })
    const g2 = makeGroup({
      id: 'FEG-2',
      processingStatus: 'Open',
      amount: 250.5,
      currencyCode: 'CAD',
    })
    const g3 = makeGroup({
      id: 'FEG-3',
      processingStatus: 'Open',
      amount: 75.25,
      currencyCode: 'CAD',
    })
    mockSpFetch.mockResolvedValueOnce(makeResponse([g1, g2, g3]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(425.75)
  })

  it('rounds to 2 decimal places', async () => {
    const g1 = makeGroup({ id: 'FEG-1', processingStatus: 'Open', amount: 10.333 })
    const g2 = makeGroup({ id: 'FEG-2', processingStatus: 'Open', amount: 5.666 })
    mockSpFetch.mockResolvedValueOnce(makeResponse([g1, g2]))

    const result = await fetchSettlementBalance()
    // 10.333 + 5.666 = 15.999 → 16.00
    expect(result.grossPendingCad).toBe(16.0)
  })

  it('follows pagination — accumulates across pages', async () => {
    const g1 = makeGroup({ id: 'FEG-P1', processingStatus: 'Open', amount: 100.0 })
    const g2 = makeGroup({ id: 'FEG-P2', processingStatus: 'Open', amount: 200.0 })

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

  it('treats group with FundTransferStatus = undefined as pending (included in total)', async () => {
    // Explicit undefined on FundTransferStatus — same as absent per B-1.
    // With ProcessingStatus='Open', lands in grossPendingCad.
    const group = {
      FinancialEventGroupId: 'FEG-U',
      ProcessingStatus: 'Open',
      FundTransferStatus: undefined,
      OriginalTotal: { CurrencyCode: 'CAD', CurrencyAmount: 99.99 },
    }
    mockSpFetch.mockResolvedValueOnce({ payload: { FinancialEventGroupList: [group] } })

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(99.99)
    expect(result.totalBalanceCad).toBe(99.99)
  })

  it('excludes InProgress groups — FundTransferStatus set means disbursement started', async () => {
    // Streamlit baseline: `if not g.get("FundTransferStatus")` — any truthy status is excluded.
    const open = makeGroup({
      id: 'FEG-OPEN',
      processingStatus: 'Open',
      amount: 1052.46,
      currencyCode: 'CAD',
    })
    const inProgress = makeGroup({
      id: 'FEG-INP',
      fundTransferStatus: 'InProgress',
      amount: 5378.72,
      currencyCode: 'CAD',
    })
    mockSpFetch.mockResolvedValueOnce(makeResponse([open, inProgress]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(1052.46)
    expect(result.deferredCad).toBe(0)
    expect(result.totalBalanceCad).toBe(1052.46)
  })

  it('puts Closed groups with no FundTransferStatus into deferredCad', async () => {
    const closed = makeGroup({
      id: 'FEG-CL',
      processingStatus: 'Closed',
      amount: 3000.0,
      currencyCode: 'CAD',
    })
    mockSpFetch.mockResolvedValueOnce(makeResponse([closed]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
    expect(result.deferredCad).toBe(3000.0)
    expect(result.totalBalanceCad).toBe(3000.0)
  })

  it('excludes Transferred groups from both open and deferred', async () => {
    const transferred = makeGroup({
      id: 'FEG-T',
      fundTransferStatus: 'Transferred',
      amount: 999.0,
      currencyCode: 'CAD',
    })
    mockSpFetch.mockResolvedValueOnce(makeResponse([transferred]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
    expect(result.deferredCad).toBe(0)
    expect(result.totalBalanceCad).toBe(0)
  })

  it('totalBalanceCad = grossPendingCad + deferredCad (split by ProcessingStatus, both require no FundTransferStatus)', async () => {
    const open = makeGroup({
      id: 'FEG-1',
      processingStatus: 'Open',
      amount: 100.0,
      currencyCode: 'CAD',
    })
    const def1 = makeGroup({
      id: 'FEG-2',
      processingStatus: 'Closed',
      amount: 200.0,
      currencyCode: 'CAD',
    })
    const def2 = makeGroup({
      id: 'FEG-3',
      processingStatus: 'Closed',
      amount: 50.0,
      currencyCode: 'CAD',
    })
    // Groups with FundTransferStatus set must be excluded regardless of value
    const inFlight = makeGroup({
      id: 'FEG-4',
      fundTransferStatus: 'InProgress',
      amount: 999.0,
      currencyCode: 'CAD',
    })
    mockSpFetch.mockResolvedValueOnce(makeResponse([open, def1, def2, inFlight]))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(100.0)
    expect(result.deferredCad).toBe(250.0)
    expect(result.totalBalanceCad).toBe(350.0)
    expect(result.openGroupsCount).toBe(1)
    expect(result.deferredGroupsCount).toBe(2)
  })
})
