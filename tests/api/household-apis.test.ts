/**
 * Lean smoke tests for the 5 Household Hub APIs:
 *   - /api/debt-payoff
 *   - /api/subscriptions
 *   - /api/vehicles
 *   - /api/cash-forecast
 *   - /api/savings-goals (GET/POST)
 *
 * Validates auth gate + happy-path response shape. Per-API math has light spot checks.
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

import { GET as getDebt } from '@/app/api/debt-payoff/route'
import { GET as getSubs } from '@/app/api/subscriptions/route'
import { GET as getVehicles } from '@/app/api/vehicles/route'
import { GET as getForecast } from '@/app/api/cash-forecast/route'
import { GET as getGoals, POST as postGoal } from '@/app/api/savings-goals/route'

beforeEach(() => {
  mockFrom.mockReset()
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-06T12:00:00Z'))
})

function emptyChain(data: unknown[] = []) {
  return Promise.resolve({ data, error: null })
}

describe('GET /api/debt-payoff', () => {
  it('returns 401 unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ gt: () => ({ not: () => ({ order: () => emptyChain() }) }) }),
      }),
    })
    const res = await getDebt()
    expect(res.status).toBe(401)
  })

  it('returns debts list with computed payoff projection', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'balance_sheet_entries') {
        return {
          select: () => ({
            eq: () => ({
              gt: () => ({
                not: () => ({
                  order: () =>
                    emptyChain([
                      {
                        id: '1',
                        name: 'BDC Loan',
                        category: 'loan',
                        balance: 11000,
                        as_of_date: '2026-05-06',
                      },
                    ]),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'journal_entry_lines') {
        return {
          select: () => ({ gt: () => ({ gte: () => emptyChain([]) }) }),
        }
      }
      throw new Error(`unmocked: ${table}`)
    })
    const res = await getDebt()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalDebt).toBe(11000)
    expect(body.debts[0].name).toBe('BDC Loan')
  })
})

describe('GET /api/subscriptions', () => {
  it('returns 401 unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    mockFrom.mockReturnValue({ select: () => ({ gte: () => ({ in: () => emptyChain() }) }) })
    const res = await getSubs()
    expect(res.status).toBe(401)
  })

  it('marks stale subscriptions when last charge >35 days ago', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        gte: () => ({
          in: () =>
            emptyChain([
              {
                date: '2026-01-15',
                vendor: 'OldSubVendor',
                category: 'Software Subscriptions',
                pretax: 50,
              },
              {
                date: '2026-04-30',
                vendor: 'ActiveSubVendor',
                category: 'Software Subscriptions',
                pretax: 25,
              },
              {
                date: '2026-05-01',
                vendor: 'ActiveSubVendor',
                category: 'Software Subscriptions',
                pretax: 25,
              },
            ]),
        }),
      }),
    }))
    const res = await getSubs()
    expect(res.status).toBe(200)
    const body = await res.json()
    const old = body.subscriptions.find((s: { vendor: string }) => s.vendor === 'OldSubVendor')
    const active = body.subscriptions.find(
      (s: { vendor: string }) => s.vendor === 'ActiveSubVendor'
    )
    expect(old.status).toBe('stale')
    expect(active.status).toBe('active')
    expect(body.staleCount).toBe(1)
  })
})

describe('GET /api/vehicles', () => {
  it('returns 401 unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    mockFrom.mockReturnValue({
      select: () => ({ gte: () => ({ in: () => emptyChain() }), or: () => emptyChain() }),
    })
    const res = await getVehicles()
    expect(res.status).toBe(401)
  })

  it('splits Pembridge insurance using business_use_pct', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'business_expenses') {
        return {
          select: () => ({
            gte: () => ({
              in: () =>
                emptyChain([
                  {
                    date: '2026-03-04',
                    vendor: 'Pembridge Insurance',
                    category: 'Vehicle Insurance',
                    pretax: 334.96,
                    business_use_pct: 60,
                  },
                ]),
            }),
          }),
        }
      }
      if (table === 'balance_sheet_entries') {
        return {
          select: () => ({
            or: () =>
              emptyChain([{ name: '2022 Tesla (Vehicle)', account_type: 'asset', balance: 39500 }]),
          }),
        }
      }
      if (table === 'mileage_log') {
        return {
          select: () => ({ gte: () => emptyChain([]) }),
        }
      }
      throw new Error(`unmocked: ${table}`)
    })
    const res = await getVehicles()
    const body = await res.json()
    const tesla = body.vehicles.find((v: { name: string }) => v.name === 'Tesla Model Y')
    const corolla = body.vehicles.find((v: { name: string }) => v.name === 'Toyota Corolla')
    // 60% of 334.96 = 200.976 → r2 → 200.98
    expect(tesla.ytdInsurance).toBeCloseTo(200.98, 1)
    expect(corolla.ytdInsurance).toBeCloseTo(133.98, 1)
  })
})

describe('GET /api/cash-forecast', () => {
  it('returns 401 unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    mockFrom.mockReturnValue({
      select: () => ({ in: () => emptyChain(), gte: () => emptyChain() }),
    })
    const res = await getForecast()
    expect(res.status).toBe(401)
  })

  it('projects current cash + monthly net flow over 30/60/90 days', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'balance_sheet_entries') {
        return {
          select: () => ({
            in: () =>
              emptyChain([
                { account_type: 'asset', category: 'bank', balance: 10000 },
                { account_type: 'asset', category: 'inventory', balance: 50000 },
                { account_type: 'liability', category: 'loan', balance: 5000 },
              ]),
          }),
        }
      }
      if (table === 'amazon_settlements') {
        return {
          select: () => ({
            gte: () => emptyChain([{ net_payout: 9000, period_end_at: '2026-04-15' }]),
          }),
        }
      }
      if (table === 'business_expenses') {
        return {
          select: () => ({ gte: () => emptyChain([{ pretax: 6000, date: '2026-04-01' }]) }),
        }
      }
      throw new Error(`unmocked: ${table}`)
    })
    const res = await getForecast()
    const body = await res.json()
    expect(body.currentCash).toBe(10000)
    expect(body.currentNetWorth).toBe(55000)
    // monthlyInflow = 9000 / 3 = 3000; monthlyOutflow = 6000 / 3 = 2000
    expect(body.monthlyInflowEstimate).toBe(3000)
    expect(body.monthlyOutflowEstimate).toBe(2000)
    expect(body.monthlyNetCashFlow).toBe(1000)
    // forecast at +90 days = current + 1000 * 3
    const ninety = body.forecast.find((f: { daysOut: number }) => f.daysOut === 90)
    expect(ninety.projectedCash).toBe(13000)
  })
})

describe('GET /api/savings-goals', () => {
  it('returns 401 unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    mockFrom.mockReturnValue({
      select: () => ({ order: () => emptyChain([]), eq: () => emptyChain([]) }),
    })
    const res = await getGoals()
    expect(res.status).toBe(401)
  })

  it('computes progress against linked balance', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'savings_goals') {
        return {
          select: () => ({
            order: () =>
              emptyChain([
                {
                  id: '1',
                  name: 'Max FHSA',
                  target_amount: 8000,
                  target_date: '2026-12-31',
                  linked_entry_name: 'FHSA',
                  notes: null,
                },
              ]),
          }),
        }
      }
      if (table === 'balance_sheet_entries') {
        return {
          select: () => ({ eq: () => emptyChain([{ name: 'FHSA', balance: 8000 }]) }),
        }
      }
      throw new Error(`unmocked: ${table}`)
    })
    const res = await getGoals()
    const body = await res.json()
    expect(body.goals[0].currentBalance).toBe(8000)
    expect(body.goals[0].progressPct).toBe(100)
    expect(body.goals[0].status).toBe('achieved')
  })

  it('POST validates required fields', async () => {
    const res = await postGoal(
      new Request('http://localhost/api/savings-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_amount: 100 }),
      })
    )
    expect(res.status).toBe(400)
  })
})
