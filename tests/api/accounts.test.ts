/**
 * Tests for app/api/accounts/route.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(
    (): Promise<{ data: { user: { id: string } | null } }> =>
      Promise.resolve({ data: { user: { id: 'user-1' } } })
  ),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({ auth: { getUser: mockGetUser }, from: mockFrom })),
}))

import { GET } from '@/app/api/accounts/route'

beforeEach(() => {
  mockFrom.mockReset()
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-06T12:00:00Z'))
})

function setup(rows: unknown[]) {
  mockFrom.mockReturnValue({
    select: () => ({
      in: () => ({
        order: () => ({
          order: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
  })
}

describe('GET /api/accounts', () => {
  it('returns 401 unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    setup([])
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('aggregates totals correctly by category', async () => {
    setup([
      {
        id: '1',
        name: 'TD Chequing',
        account_type: 'asset',
        category: 'bank',
        balance: 1500,
        as_of_date: '2026-05-01',
        notes: null,
        sort_order: 1,
      },
      {
        id: '2',
        name: 'Personal Chequing',
        account_type: 'asset',
        category: 'personal_bank',
        balance: 11000,
        as_of_date: '2026-05-01',
        notes: null,
        sort_order: 2,
      },
      {
        id: '3',
        name: 'FHSA',
        account_type: 'asset',
        category: 'personal_investment',
        balance: 8000,
        as_of_date: '2026-05-01',
        notes: null,
        sort_order: 3,
      },
      {
        id: '4',
        name: 'CT MasterCard',
        account_type: 'liability',
        category: 'credit_card',
        balance: 18000,
        as_of_date: '2026-04-10',
        notes: null,
        sort_order: 4,
      },
      {
        id: '5',
        name: 'BDC',
        account_type: 'liability',
        category: 'loan',
        balance: 11000,
        as_of_date: '2026-05-01',
        notes: null,
        sort_order: 5,
      },
      {
        id: '6',
        name: 'GST Payable',
        account_type: 'liability',
        category: 'tax',
        balance: 2000,
        as_of_date: '2026-05-01',
        notes: null,
        sort_order: 6,
      },
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalCash).toBe(12500) // 1500 + 11000
    expect(body.totalInvestments).toBe(8000)
    expect(body.totalCardsOwing).toBe(18000)
    expect(body.totalLoans).toBe(11000)
    expect(body.totalTaxOwing).toBe(2000)
    expect(body.totalAssets).toBe(20500)
    expect(body.totalLiabilities).toBe(31000)
    expect(body.netWorth).toBe(-10500)
  })

  it('flags stale accounts (>60 days since update)', async () => {
    setup([
      {
        id: '1',
        name: 'Old',
        account_type: 'asset',
        category: 'bank',
        balance: 100,
        as_of_date: '2026-01-01',
        notes: null,
        sort_order: 1,
      },
      {
        id: '2',
        name: 'Recent',
        account_type: 'asset',
        category: 'bank',
        balance: 200,
        as_of_date: '2026-05-01',
        notes: null,
        sort_order: 2,
      },
    ])
    const res = await GET()
    const body = await res.json()
    const old = body.accounts.find((a: { name: string }) => a.name === 'Old')
    const recent = body.accounts.find((a: { name: string }) => a.name === 'Recent')
    expect(old.freshness).toBe('stale')
    expect(old.days_since_update).toBeGreaterThan(60)
    expect(recent.freshness).toBe('fresh')
    expect(body.staleCount).toBe(1)
  })

  it('flags aging accounts (30-60 days)', async () => {
    setup([
      {
        id: '1',
        name: 'Aging',
        account_type: 'asset',
        category: 'bank',
        balance: 100,
        as_of_date: '2026-04-01',
        notes: null,
        sort_order: 1,
      },
    ])
    const res = await GET()
    const body = await res.json()
    expect(body.accounts[0].freshness).toBe('aging')
  })
})
