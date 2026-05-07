/**
 * Tests for app/api/annual-review/route.ts.
 *
 * Validates:
 *   - Auth gate
 *   - Year row math (jan1, yearEnd, delta, deltaPct)
 *   - Verdict logic (winning when debt eliminated, etc.)
 *   - Headline string includes key signals
 *   - Current year flagged isYtd=true; uses live computed currentLive
 *   - Debt eliminated sums money_impact of category='debt' milestones in that year
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface SnapshotRow {
  snapshot_date: string
  net_worth: string | number
}

interface MilestoneRow {
  id: string
  milestone_date: string
  category: string
  title: string
  description: string | null
  money_impact: string | number | null
  created_at: string
  updated_at: string
}

interface BalanceSheetRow {
  account_type: 'asset' | 'liability'
  balance: string | number
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

import { GET } from '@/app/api/annual-review/route'

beforeEach(() => {
  mockFrom.mockReset()
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-06T12:00:00Z'))
})

interface SuiteState {
  snapshots?: SnapshotRow[]
  milestones?: MilestoneRow[]
  balanceSheet?: BalanceSheetRow[]
}

function setupTables(state: SuiteState) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'net_worth_snapshots') {
      return {
        select: () => ({
          order: () => Promise.resolve({ data: state.snapshots ?? [], error: null }),
        }),
      }
    }
    if (table === 'life_milestones') {
      return {
        select: () => ({
          order: () => Promise.resolve({ data: state.milestones ?? [], error: null }),
        }),
      }
    }
    if (table === 'balance_sheet_entries') {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: state.balanceSheet ?? [], error: null }),
        }),
      }
    }
    throw new Error(`unmocked: ${table}`)
  })
}

describe('GET /api/annual-review — auth', () => {
  it('returns 401 when no user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    setupTables({})
    const res = await GET()
    expect(res.status).toBe(401)
  })
})

describe('GET /api/annual-review — math', () => {
  it('computes jan1Liquid from snapshot on or before previous Dec 31', async () => {
    setupTables({
      snapshots: [
        { snapshot_date: '2024-12-31', net_worth: 50000 },
        { snapshot_date: '2025-12-31', net_worth: 60000 },
      ],
      balanceSheet: [
        { account_type: 'asset', balance: 90000 },
        { account_type: 'liability', balance: 30000 },
      ],
    })
    const res = await GET()
    const body = await res.json()
    const yr2025 = body.years.find((y: { year: number }) => y.year === 2025)
    expect(yr2025.jan1Liquid).toBe(50000)
    expect(yr2025.yearEndLiquid).toBe(60000)
    expect(yr2025.delta).toBe(10000)
  })

  it('uses live balance sheet net worth for current year YTD', async () => {
    setupTables({
      snapshots: [{ snapshot_date: '2025-12-31', net_worth: 100000 }],
      balanceSheet: [
        { account_type: 'asset', balance: 90000 },
        { account_type: 'liability', balance: 40000 },
      ],
    })
    const res = await GET()
    const body = await res.json()
    const yr2026 = body.years.find((y: { year: number }) => y.year === 2026)
    expect(yr2026.isYtd).toBe(true)
    expect(yr2026.jan1Liquid).toBe(100000)
    expect(yr2026.yearEndLiquid).toBe(50000) // live: 90 - 40
    expect(yr2026.delta).toBe(-50000)
    expect(body.currentLive.netWorth).toBe(50000)
  })

  it('verdict=winning when wealth flat/up AND debt eliminated', async () => {
    setupTables({
      snapshots: [{ snapshot_date: '2025-12-31', net_worth: 50000 }],
      milestones: [
        {
          id: '1',
          milestone_date: '2026-04-13',
          category: 'debt',
          title: 'Tesla paid off',
          description: null,
          money_impact: 40000,
          created_at: 'x',
          updated_at: 'x',
        },
      ],
      balanceSheet: [
        { account_type: 'asset', balance: 60000 },
        { account_type: 'liability', balance: 10000 },
      ],
    })
    const res = await GET()
    const body = await res.json()
    const yr2026 = body.years.find((y: { year: number }) => y.year === 2026)
    expect(yr2026.debtEliminated).toBe(40000)
    expect(yr2026.verdict).toBe('winning')
    expect(body.headline).toMatch(/winning/i)
  })

  it('verdict=winning when wealth flat (small delta) but debt eliminated', async () => {
    setupTables({
      snapshots: [{ snapshot_date: '2025-12-31', net_worth: 20000 }],
      milestones: [
        {
          id: '1',
          milestone_date: '2026-04-13',
          category: 'debt',
          title: 'BDC paydown',
          description: null,
          money_impact: 89000,
          created_at: 'x',
          updated_at: 'x',
        },
      ],
      balanceSheet: [
        { account_type: 'asset', balance: 22000 },
        { account_type: 'liability', balance: 5000 },
      ],
    })
    const res = await GET()
    const body = await res.json()
    const yr2026 = body.years.find((y: { year: number }) => y.year === 2026)
    expect(Math.abs(yr2026.delta)).toBeLessThan(5000)
    expect(yr2026.verdict).toBe('winning')
  })

  it('verdict=tightening when both wealth and no debt elimination', async () => {
    setupTables({
      snapshots: [{ snapshot_date: '2025-12-31', net_worth: 100000 }],
      milestones: [],
      balanceSheet: [
        { account_type: 'asset', balance: 60000 },
        { account_type: 'liability', balance: 10000 },
      ],
    })
    const res = await GET()
    const body = await res.json()
    const yr2026 = body.years.find((y: { year: number }) => y.year === 2026)
    expect(yr2026.delta).toBe(-50000)
    expect(yr2026.debtEliminated).toBe(0)
    expect(yr2026.verdict).toBe('tightening')
  })

  it('milestoneCount counts milestones in that year only', async () => {
    setupTables({
      milestones: [
        {
          id: '1',
          milestone_date: '2025-06-01',
          category: 'business',
          title: '2025 event',
          description: null,
          money_impact: null,
          created_at: 'x',
          updated_at: 'x',
        },
        {
          id: '2',
          milestone_date: '2026-01-15',
          category: 'family',
          title: '2026 event',
          description: null,
          money_impact: null,
          created_at: 'x',
          updated_at: 'x',
        },
        {
          id: '3',
          milestone_date: '2026-03-01',
          category: 'debt',
          title: 'Another 2026',
          description: null,
          money_impact: null,
          created_at: 'x',
          updated_at: 'x',
        },
      ],
      balanceSheet: [],
    })
    const res = await GET()
    const body = await res.json()
    const yr2025 = body.years.find((y: { year: number }) => y.year === 2025)
    const yr2026 = body.years.find((y: { year: number }) => y.year === 2026)
    expect(yr2025.milestoneCount).toBe(1)
    expect(yr2026.milestoneCount).toBe(2)
  })

  it('debtEliminated only counts category=debt milestones with non-null money_impact', async () => {
    setupTables({
      milestones: [
        {
          id: '1',
          milestone_date: '2026-01-15',
          category: 'debt',
          title: 'A',
          description: null,
          money_impact: 10000,
          created_at: 'x',
          updated_at: 'x',
        },
        {
          id: '2',
          milestone_date: '2026-03-01',
          category: 'debt',
          title: 'B (no impact)',
          description: null,
          money_impact: null,
          created_at: 'x',
          updated_at: 'x',
        },
        {
          id: '3',
          milestone_date: '2026-04-01',
          category: 'family',
          title: 'C (not debt)',
          description: null,
          money_impact: 5000,
          created_at: 'x',
          updated_at: 'x',
        },
      ],
      balanceSheet: [],
    })
    const res = await GET()
    const body = await res.json()
    const yr2026 = body.years.find((y: { year: number }) => y.year === 2026)
    expect(yr2026.debtEliminated).toBe(10000)
  })
})
