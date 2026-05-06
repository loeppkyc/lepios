/**
 * Tests for app/api/pnl/route.ts after periodic-inventory COGS rewrite.
 *
 * Validates:
 *   - Auth gate
 *   - FBA fee categories counted as COGS, not OpEx
 *   - Periodic-inventory math: COGS = β + Purchases - E + FBA fees when both snapshots exist
 *   - Months without snapshot show approx COGS (FBA fees only)
 *   - Months with NO data return cogs=null
 *   - Refund categories reduce COGS (negative pretax)
 *   - YTD totals contagion (any month null → totals null)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface SettlementRow {
  net_payout: number
  period_end_at: string
}
interface ExpenseRow {
  date: string
  category: string
  pretax: number
}
interface SnapshotRow {
  snapshot_date: string
  value_at_cost: number
}
interface CogsEntryRow {
  purchased_at: string
  total_cost_cad: number
}
interface PalletInvoiceRow {
  invoice_month: string
  total_cost_cad: number
}

const { mockFrom, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(
    (): Promise<{ data: { user: { id: string } | null } }> =>
      Promise.resolve({ data: { user: { id: 'user-1' } } })
  ),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    })
  ),
}))

import { GET } from '@/app/api/pnl/route'

beforeEach(() => {
  mockFrom.mockReset()
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
})

interface SuiteState {
  settlements?: SettlementRow[]
  expenses?: ExpenseRow[]
  snapshots?: SnapshotRow[]
  cogsEntries?: CogsEntryRow[]
  palletInvoices?: PalletInvoiceRow[]
}

function setupTables(state: SuiteState) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'amazon_settlements') {
      const data = state.settlements ?? []
      return {
        select: () => ({
          gte: () => ({
            lte: () => Promise.resolve({ data, error: null }),
          }),
        }),
      }
    }
    if (table === 'business_expenses') {
      const data = state.expenses ?? []
      return {
        select: () => ({
          gte: () => ({
            lte: () => Promise.resolve({ data, error: null }),
          }),
        }),
      }
    }
    if (table === 'inventory_snapshots') {
      const data = state.snapshots ?? []
      return {
        select: () => ({
          order: () => Promise.resolve({ data, error: null }),
        }),
      }
    }
    if (table === 'cogs_entries') {
      const data = state.cogsEntries ?? []
      return {
        select: () => ({
          gte: () => ({
            lte: () => Promise.resolve({ data, error: null }),
          }),
        }),
      }
    }
    if (table === 'pallet_invoices') {
      const data = state.palletInvoices ?? []
      return {
        select: () => ({
          gte: () => ({
            lte: () => Promise.resolve({ data, error: null }),
          }),
        }),
      }
    }
    throw new Error(`unmocked table: ${table}`)
  })
}

function req(year: number | string | null = 2026): Request {
  if (year == null) return new Request('http://localhost/api/pnl')
  return new Request(`http://localhost/api/pnl?year=${year}`)
}

describe('GET /api/pnl — auth + validation', () => {
  it('requires year query', async () => {
    setupTables({})
    const res = await GET(req(null))
    expect(res.status).toBe(400)
  })

  it('rejects malformed year', async () => {
    setupTables({})
    const res = await GET(req('abc'))
    expect(res.status).toBe(400)
  })

  it('returns 401 when no user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    setupTables({})
    const res = await GET(req(2026))
    expect(res.status).toBe(401)
  })
})

describe('FBA fees counted as COGS', () => {
  it('FBA Selling Fees go to COGS, not OpEx', async () => {
    setupTables({
      settlements: [{ net_payout: 1000, period_end_at: '2026-02-15T00:00:00Z' }],
      expenses: [
        { date: '2026-02-10', category: 'FBA Selling Fees (Amazon.ca)', pretax: 200 },
        { date: '2026-02-12', category: 'Software Subscriptions', pretax: 50 },
      ],
    })
    const res = await GET(req(2026))
    const body = await res.json()
    const feb = body.months.find(
      (m: { month: string; cogsBreakdown: { fbaFees: number } }) => m.month === '2026-02'
    )
    expect(feb.cogsBreakdown.fbaFees).toBe(200)
    expect(feb.opex).toBe(50)
    expect(feb.cogsApprox).toBe(true) // no inventory snapshots in this test
  })

  it('Refund categories (negative pretax) reduce COGS', async () => {
    setupTables({
      expenses: [
        { date: '2026-03-01', category: 'FBA Selling Fees (Amazon.ca)', pretax: 1000 },
        { date: '2026-03-05', category: 'Seller Fee Refunds (Amazon.ca)', pretax: -150 },
      ],
    })
    const res = await GET(req(2026))
    const body = await res.json()
    const mar = body.months.find((m: { month: string }) => m.month === '2026-03')
    expect(mar.cogsBreakdown.fbaFees).toBe(850)
  })
})

describe('Periodic inventory COGS', () => {
  it('computes β + Purchases − E + FBA fees when snapshots and ending in-month exist', async () => {
    setupTables({
      settlements: [],
      expenses: [{ date: '2026-04-15', category: 'FBA Selling Fees (Amazon.ca)', pretax: 500 }],
      snapshots: [
        { snapshot_date: '2026-03-31', value_at_cost: 100000 },
        { snapshot_date: '2026-04-30', value_at_cost: 60000 },
      ],
      cogsEntries: [{ purchased_at: '2026-04-10', total_cost_cad: 5000 }],
    })
    const res = await GET(req(2026))
    const body = await res.json()
    const apr = body.months.find((m: { month: string }) => m.month === '2026-04')
    // β=100k, P=5k, E=60k, FBA=500
    // drawdown = 100k + 5k - 60k = 45k
    // cogs = 45k + 500 = 45500
    expect(apr.cogsBreakdown.beginningInventory).toBe(100000)
    expect(apr.cogsBreakdown.endingInventory).toBe(60000)
    expect(apr.cogsBreakdown.purchases).toBe(5000)
    expect(apr.cogsBreakdown.fbaFees).toBe(500)
    expect(apr.cogsBreakdown.inventoryDrawdown).toBe(45000)
    expect(apr.cogs).toBe(45500)
    expect(apr.cogsApprox).toBe(false)
  })

  it('marks month approx (FBA fees only) when no fresh snapshot in that month', async () => {
    setupTables({
      expenses: [{ date: '2026-05-15', category: 'FBA Selling Fees (Amazon.ca)', pretax: 700 }],
      snapshots: [
        { snapshot_date: '2026-03-31', value_at_cost: 100000 },
        // no May snapshot
      ],
    })
    const res = await GET(req(2026))
    const body = await res.json()
    const may = body.months.find((m: { month: string }) => m.month === '2026-05')
    expect(may.cogsApprox).toBe(true)
    expect(may.cogs).toBe(700)
    expect(may.cogsBreakdown.inventoryDrawdown).toBeNull()
  })

  it('returns cogs=null when month has no data at all', async () => {
    setupTables({})
    const res = await GET(req(2026))
    const body = await res.json()
    const jan = body.months.find((m: { month: string }) => m.month === '2026-01')
    expect(jan.cogs).toBeNull()
    expect(jan.netProfit).toBeNull()
  })
})

describe('YTD totals contagion', () => {
  it('any null monthly cogs → totals.cogs is null', async () => {
    setupTables({
      settlements: [{ net_payout: 1000, period_end_at: '2026-04-15T00:00:00Z' }],
      expenses: [{ date: '2026-04-15', category: 'Software Subscriptions', pretax: 50 }],
      // no snapshots, no fba — Apr has cogs=null
    })
    const res = await GET(req(2026))
    const body = await res.json()
    expect(body.totals.cogs).toBeNull()
    expect(body.totals.netProfit).toBeNull()
  })

  it('counts FBA fees and inventory drawdown contributions in totals', async () => {
    setupTables({
      expenses: [
        { date: '2026-04-15', category: 'FBA Selling Fees (Amazon.ca)', pretax: 500 },
        { date: '2026-04-20', category: 'FBA Transactions Fees (Amazon.ca)', pretax: 300 },
      ],
      snapshots: [
        { snapshot_date: '2026-03-31', value_at_cost: 100000 },
        { snapshot_date: '2026-04-30', value_at_cost: 60000 },
      ],
    })
    const res = await GET(req(2026))
    const body = await res.json()
    expect(body.totals.fbaFeesIncludedInCogs).toBe(800)
    // Apr drawdown = 100k - 60k = 40k (no purchases)
    expect(body.totals.inventoryDrawdownIncludedInCogs).toBe(40000)
  })
})
