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

function makeGroupsResponse(groups: ReturnType<typeof makeGroup>[], nextToken?: string) {
  return {
    payload: {
      FinancialEventGroupList: groups,
      ...(nextToken ? { NextToken: nextToken } : {}),
    },
  }
}

// Empty DDBR response — used in Promise.all interleave as 2nd mock call.
// Shape mirrors real SP-API: { payload: { transactions, nextToken? } }.
const DDBR_EMPTY = { payload: { transactions: [] } }

function makeDdbr(cadAmount: number) {
  return {
    payload: {
      transactions: [
        {
          transactionStatus: 'DEFERRED',
          totalAmount: { currencyCode: 'CAD', currencyAmount: cadAmount },
        },
      ],
    },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fetchSettlementBalance', () => {
  beforeEach(() => {
    mockSpFetch.mockReset()
  })

  // NOTE: fetchSettlementBalance runs fetchAllFinancialEventGroups + fetchDdbrBalance
  // in Promise.all. Mock call order: groups p1 → DDBR → groups p2 (if paginating).

  it('sums OriginalTotal.CurrencyAmount for open CAD groups only', async () => {
    const openCad = makeGroup({
      id: 'FEG-001',
      processingStatus: 'Open',
      amount: 928.17,
      currencyCode: 'CAD',
    })
    // FTS='Succeeded' = already paid out, excluded
    const closedCad = makeGroup({
      id: 'FEG-002',
      fundTransferStatus: 'Succeeded',
      amount: 500.0,
      currencyCode: 'CAD',
    })
    // open MXN group (must be excluded — Constraint B-2)
    const openMxn = makeGroup({ id: 'FEG-003', amount: 0, currencyCode: 'MXN' })

    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([openCad, closedCad, openMxn])) // groups
      .mockResolvedValueOnce(DDBR_EMPTY) // DDBR

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(928.17)
  })

  it('excludes closed groups (FundTransferStatus = "Succeeded")', async () => {
    const closed = makeGroup({ id: 'FEG-C', fundTransferStatus: 'Succeeded', amount: 1000.0 })
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([closed]))
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
  })

  it('excludes open MXN groups (Constraint B-2)', async () => {
    const openMxn = makeGroup({ id: 'FEG-MX', amount: 100.0, currencyCode: 'MXN' })
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([openMxn]))
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
  })

  it('returns 0 when all groups are paid out (Succeeded)', async () => {
    const g1 = makeGroup({ id: 'FEG-X', fundTransferStatus: 'Succeeded', amount: 200.0 })
    const g2 = makeGroup({ id: 'FEG-Y', fundTransferStatus: 'Succeeded', amount: 350.0 })
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([g1, g2]))
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
  })

  it('returns 0 on empty group list', async () => {
    mockSpFetch.mockResolvedValueOnce(makeGroupsResponse([])).mockResolvedValueOnce(DDBR_EMPTY)

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
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([g1, g2, g3]))
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(425.75)
  })

  it('rounds to 2 decimal places', async () => {
    const g1 = makeGroup({ id: 'FEG-1', processingStatus: 'Open', amount: 10.333 })
    const g2 = makeGroup({ id: 'FEG-2', processingStatus: 'Open', amount: 5.666 })
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([g1, g2]))
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    // 10.333 + 5.666 = 15.999 → 16.00
    expect(result.grossPendingCad).toBe(16.0)
  })

  it('follows pagination — accumulates across pages', async () => {
    const g1 = makeGroup({ id: 'FEG-P1', processingStatus: 'Open', amount: 100.0 })
    const g2 = makeGroup({ id: 'FEG-P2', processingStatus: 'Open', amount: 200.0 })

    // Promise.all interleave: groups p1 → DDBR → groups p2
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([g1], 'TOKEN-1')) // groups page 1
      .mockResolvedValueOnce(DDBR_EMPTY) // DDBR (interleaved)
      .mockResolvedValueOnce(makeGroupsResponse([g2])) // groups page 2

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(300.0)
    expect(mockSpFetch).toHaveBeenCalledTimes(3)
  })

  it('returns fetchedAt as a valid ISO timestamp', async () => {
    mockSpFetch.mockResolvedValueOnce(makeGroupsResponse([])).mockResolvedValueOnce(DDBR_EMPTY)

    const before = new Date().toISOString()
    const result = await fetchSettlementBalance()
    const after = new Date().toISOString()

    expect(result.fetchedAt >= before).toBe(true)
    expect(result.fetchedAt <= after).toBe(true)
  })

  it('treats group with FundTransferStatus = undefined as pending (included in total)', async () => {
    const group = {
      FinancialEventGroupId: 'FEG-U',
      ProcessingStatus: 'Open',
      FundTransferStatus: undefined,
      OriginalTotal: { CurrencyCode: 'CAD', CurrencyAmount: 99.99 },
    }
    mockSpFetch
      .mockResolvedValueOnce({ payload: { FinancialEventGroupList: [group] } })
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(99.99)
    expect(result.totalBalanceCad).toBe(99.99)
  })

  it('Processing groups do NOT contribute to totalBalanceCad — already-initiated payouts are not balance', async () => {
    const open = makeGroup({
      id: 'FEG-OPEN',
      processingStatus: 'Open',
      amount: 1052.46,
      currencyCode: 'CAD',
    })
    const inProgress = makeGroup({
      id: 'FEG-INP',
      fundTransferStatus: 'Processing',
      amount: 5378.72,
      currencyCode: 'CAD',
    })
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([open, inProgress]))
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(1052.46)
    expect(result.deferredCad).toBe(0)
    // Amazon "Total Balance" = open + deferred only. Excludes in-flight payouts.
    expect(result.totalBalanceCad).toBe(1052.46)
  })

  it('puts Closed groups with no FundTransferStatus into deferredCad (DDBR fallback)', async () => {
    const closed = makeGroup({
      id: 'FEG-CL',
      processingStatus: 'Closed',
      amount: 3000.0,
      currencyCode: 'CAD',
    })
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([closed]))
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
    expect(result.deferredCad).toBe(3000.0)
    expect(result.totalBalanceCad).toBe(3000.0)
  })

  it('Succeeded groups do not affect balance buckets', async () => {
    const succeeded = makeGroup({
      id: 'FEG-T',
      fundTransferStatus: 'Succeeded',
      amount: 999.0,
      currencyCode: 'CAD',
    })
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([succeeded]))
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(0)
    expect(result.deferredCad).toBe(0)
    expect(result.totalBalanceCad).toBe(0)
  })

  it('open + closed-deferred fallback: totalBalanceCad excludes Processing groups', async () => {
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
    const inFlight = makeGroup({
      id: 'FEG-4',
      fundTransferStatus: 'Processing',
      amount: 999.0,
      currencyCode: 'CAD',
    })
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([open, def1, def2, inFlight]))
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(100.0)
    expect(result.deferredCad).toBe(250.0)
    expect(result.totalBalanceCad).toBe(350.0) // 100 + 250, no in-flight
    expect(result.openGroupsCount).toBe(1)
    expect(result.deferredGroupsCount).toBe(2)
  })

  it('ddbrCad is null and ddbrAvailable is false when v2024-06-19 returns empty', async () => {
    mockSpFetch.mockResolvedValueOnce(makeGroupsResponse([])).mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.ddbrCad).toBeNull()
    expect(result.ddbrAvailable).toBe(false)
  })

  it('ddbrCad and ddbrAvailable reflect DDBR when v2024-06-19 returns transactions', async () => {
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([]))
      .mockResolvedValueOnce(makeDdbr(5362.35))

    const result = await fetchSettlementBalance()
    expect(result.ddbrCad).toBe(5362.35)
    expect(result.ddbrAvailable).toBe(true)
  })

  it('totalBalanceCad includes ddbrCad when available', async () => {
    const open = makeGroup({
      id: 'FEG-O',
      processingStatus: 'Open',
      amount: 146.92,
      currencyCode: 'CAD',
    })
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([open]))
      .mockResolvedValueOnce(makeDdbr(5362.35))

    const result = await fetchSettlementBalance()
    expect(result.grossPendingCad).toBe(146.92)
    expect(result.ddbrCad).toBe(5362.35)
    expect(result.totalBalanceCad).toBe(Math.round((146.92 + 5362.35) * 100) / 100)
  })

  it('totalBalanceCad excludes null ddbrCad', async () => {
    const open = makeGroup({
      id: 'FEG-O',
      processingStatus: 'Open',
      amount: 146.92,
      currencyCode: 'CAD',
    })
    mockSpFetch.mockResolvedValueOnce(makeGroupsResponse([open])).mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.totalBalanceCad).toBe(146.92)
  })

  it('ddbrAvailable false when v2024-06-19 throws (best-effort enrichment)', async () => {
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([]))
      .mockRejectedValueOnce(
        new Error('SP-API GET /finances/2024-06-19/transactions (403): forbidden')
      )

    const result = await fetchSettlementBalance()
    expect(result.ddbrCad).toBeNull()
    expect(result.ddbrAvailable).toBe(false)
    // Groups still processed normally
    expect(result.grossPendingCad).toBe(0)
  })

  // ── DDBR-vs-FEG-deferred precedence ───────────────────────────────────────
  // Same money, two API surfaces — never double-count.

  it('DDBR replaces FEG-deferred when both present (no double-count)', async () => {
    const closedFegDeferred = makeGroup({
      id: 'FEG-CL',
      processingStatus: 'Closed',
      amount: 3000.0, // would land in fegDeferred under fallback
      currencyCode: 'CAD',
    })
    mockSpFetch
      .mockResolvedValueOnce(makeGroupsResponse([closedFegDeferred]))
      .mockResolvedValueOnce(makeDdbr(7285.59)) // canonical Amazon "Deferred"

    const result = await fetchSettlementBalance()
    // deferredCad = DDBR canonical, NOT 3000 + 7285.59
    expect(result.deferredCad).toBe(7285.59)
    expect(result.totalBalanceCad).toBe(7285.59)
    // FEG fallback path is silenced when DDBR is canonical
    expect(result.deferredGroupsCount).toBe(0)
  })

  // ── lastPayout — most-recent transfer ─────────────────────────────────────

  it('lastPayout is null when no Processing/Succeeded groups exist', async () => {
    const open = makeGroup({
      id: 'FEG-OPEN',
      processingStatus: 'Open',
      amount: 100.0,
      currencyCode: 'CAD',
    })
    mockSpFetch.mockResolvedValueOnce(makeGroupsResponse([open])).mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.lastPayout).toBeNull()
  })

  it('lastPayout picks the most recent FundTransferDate across CAD groups', async () => {
    const older = {
      FinancialEventGroupId: 'FEG-OLD',
      FundTransferStatus: 'Succeeded',
      FundTransferDate: '2026-04-25T10:00:00Z',
      OriginalTotal: { CurrencyCode: 'CAD', CurrencyAmount: 800.0 },
    }
    const newer = {
      FinancialEventGroupId: 'FEG-NEW',
      FundTransferStatus: 'Processing',
      FundTransferDate: '2026-05-02T14:30:00Z',
      OriginalTotal: { CurrencyCode: 'CAD', CurrencyAmount: 1013.9 },
    }
    mockSpFetch
      .mockResolvedValueOnce({ payload: { FinancialEventGroupList: [older, newer] } })
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.lastPayout).toEqual({
      amountCad: 1013.9,
      transferDate: '2026-05-02T14:30:00Z',
      status: 'Processing',
    })
  })

  it('lastPayout ignores non-CAD groups', async () => {
    const usdNewer = {
      FinancialEventGroupId: 'FEG-USD',
      FundTransferStatus: 'Succeeded',
      FundTransferDate: '2026-05-05T00:00:00Z',
      OriginalTotal: { CurrencyCode: 'USD', CurrencyAmount: 5000 },
    }
    const cadOlder = {
      FinancialEventGroupId: 'FEG-CAD',
      FundTransferStatus: 'Succeeded',
      FundTransferDate: '2026-04-30T00:00:00Z',
      OriginalTotal: { CurrencyCode: 'CAD', CurrencyAmount: 500.0 },
    }
    mockSpFetch
      .mockResolvedValueOnce({ payload: { FinancialEventGroupList: [usdNewer, cadOlder] } })
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.lastPayout?.transferDate).toBe('2026-04-30T00:00:00Z')
    expect(result.lastPayout?.amountCad).toBe(500.0)
  })

  it('lastPayout requires FundTransferDate — Processing groups without it are skipped', async () => {
    const noDate = {
      FinancialEventGroupId: 'FEG-NODATE',
      FundTransferStatus: 'Processing',
      OriginalTotal: { CurrencyCode: 'CAD', CurrencyAmount: 999.0 },
      // FundTransferDate intentionally absent
    }
    mockSpFetch
      .mockResolvedValueOnce({ payload: { FinancialEventGroupList: [noDate] } })
      .mockResolvedValueOnce(DDBR_EMPTY)

    const result = await fetchSettlementBalance()
    expect(result.lastPayout).toBeNull()
  })

  // ── DDBR response-shape regression guard ──────────────────────────────────
  // Real SP-API wraps in `payload`. Pre-2026-05-07 code read `data.transactions`
  // directly and silently dropped all deferred. This test fails if the parsing
  // path regresses.

  it('parses DDBR transactions from payload-wrapped response (real SP-API shape)', async () => {
    mockSpFetch.mockResolvedValueOnce(makeGroupsResponse([])).mockResolvedValueOnce({
      payload: {
        transactions: [
          {
            transactionStatus: 'DEFERRED',
            totalAmount: { currencyCode: 'CAD', currencyAmount: 100.0 },
          },
          {
            transactionStatus: 'DEFERRED',
            totalAmount: { currencyCode: 'CAD', currencyAmount: 200.0 },
          },
        ],
      },
    })

    const result = await fetchSettlementBalance()
    expect(result.ddbrCad).toBe(300.0)
    expect(result.ddbrAvailable).toBe(true)
  })
})
