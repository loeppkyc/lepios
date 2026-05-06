/**
 * Tests for app/api/net-worth/{route,snapshot,history}.
 *
 * Validates:
 *   - 401 when unauthenticated
 *   - Net Worth math (assets - liabilities) on the rows the route receives
 *     (equity exclusion is enforced at the DB query layer via .in())
 *   - byPillar: personal_* categories vs business
 *   - byCategory aggregation
 *   - changeSinceSnapshot delta math
 *   - Snapshot insertion with correct totals + notes validation
 *   - History limit cap + ASC ordering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface SupabaseRow {
  id: string
  name: string
  account_type: 'asset' | 'liability'
  category: string
  balance: number
  as_of_date: string
  notes: string | null
  sort_order: number
}

interface SnapshotRow {
  id: string
  snapshot_date: string
  total_assets: number
  total_liabilities: number
  net_worth: number
  breakdown: Record<string, unknown> | null
  notes: string | null
  created_at: string
}

const { mockFrom, mockGetUser, insertCapture } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(
    (): Promise<{ data: { user: { id: string } | null } }> =>
      Promise.resolve({ data: { user: { id: 'user-1' } } })
  ),
  insertCapture: { row: null as Record<string, unknown> | null },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    })
  ),
}))

import { GET as getNetWorth } from '@/app/api/net-worth/route'
import { POST as postSnapshot } from '@/app/api/net-worth/snapshot/route'
import { GET as getHistory } from '@/app/api/net-worth/history/route'

beforeEach(() => {
  mockFrom.mockReset()
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  insertCapture.row = null
})

function makeEntry(overrides: Partial<SupabaseRow>): SupabaseRow {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? 'Acct',
    account_type: overrides.account_type ?? 'asset',
    category: overrides.category ?? 'bank',
    balance: overrides.balance ?? 0,
    as_of_date: overrides.as_of_date ?? '2026-03-31',
    notes: overrides.notes ?? null,
    sort_order: overrides.sort_order ?? 0,
  }
}

interface SuiteState {
  entries?: SupabaseRow[]
  snapshots?: SnapshotRow[]
  insertResult?: SnapshotRow
  insertError?: { message: string }
  capturedHistoryLimit?: number
}

function setupTables(state: SuiteState) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'balance_sheet_entries') {
      const data = state.entries ?? []
      const result = Promise.resolve({ data, error: null })
      // Both GET (.in().order().order()) and POST (.in()) must resolve.
      const inResult = Object.assign(result, {
        order: () => ({
          order: () => result,
        }),
      })
      return {
        select: () => ({
          in: () => inResult,
        }),
      }
    }
    if (table === 'net_worth_snapshots') {
      const snaps = state.snapshots ?? []
      const result = Promise.resolve({ data: snaps, error: null })
      // GET history: .select().order().order().limit(N)
      const orderChain = {
        order: () => ({
          limit: (n: number) => {
            state.capturedHistoryLimit = n
            return result
          },
        }),
      }
      const insertResult = Promise.resolve(
        state.insertError
          ? { data: null, error: state.insertError }
          : { data: state.insertResult ?? null, error: null }
      )
      return {
        select: () => ({
          order: () => orderChain,
        }),
        insert: (row: Record<string, unknown>) => {
          insertCapture.row = row
          return {
            select: () => ({
              single: () => insertResult,
            }),
          }
        },
      }
    }
    throw new Error(`unmocked table: ${table}`)
  })
  return state
}

describe('GET /api/net-worth — auth', () => {
  it('returns 401 when no user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    setupTables({})
    const res = await getNetWorth()
    expect(res.status).toBe(401)
  })
})

describe('GET /api/net-worth — math', () => {
  it('computes totalAssets, totalLiabilities, netWorth', async () => {
    setupTables({
      entries: [
        makeEntry({ account_type: 'asset', category: 'bank', balance: 10000 }),
        makeEntry({ account_type: 'asset', category: 'inventory', balance: 50000 }),
        makeEntry({ account_type: 'liability', category: 'loan', balance: 8000 }),
      ],
    })
    const res = await getNetWorth()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalAssets).toBe(60000)
    expect(body.totalLiabilities).toBe(8000)
    expect(body.netWorth).toBe(52000)
  })

  it('byPillar splits personal_* categories from business', async () => {
    setupTables({
      entries: [
        makeEntry({ account_type: 'asset', category: 'bank', balance: 10000 }),
        makeEntry({ account_type: 'asset', category: 'inventory', balance: 50000 }),
        makeEntry({ account_type: 'liability', category: 'loan', balance: 8000 }),
        makeEntry({ account_type: 'asset', category: 'personal_bank', balance: 5000 }),
        makeEntry({ account_type: 'asset', category: 'personal_investment', balance: 30000 }),
        makeEntry({ account_type: 'liability', category: 'credit_card', balance: 1000 }),
      ],
    })
    const res = await getNetWorth()
    const body = await res.json()
    expect(body.byPillar.business).toBe(10000 + 50000 - 8000 - 1000)
    expect(body.byPillar.personal).toBe(5000 + 30000)
    expect(body.byPillar.business + body.byPillar.personal).toBe(body.netWorth)
  })

  it('byCategory groups rows by account_type:category', async () => {
    setupTables({
      entries: [
        makeEntry({ account_type: 'asset', category: 'bank', balance: 10000 }),
        makeEntry({ account_type: 'asset', category: 'bank', balance: 5000 }),
        makeEntry({ account_type: 'liability', category: 'credit_card', balance: 200 }),
      ],
    })
    const res = await getNetWorth()
    const body = await res.json()
    const bank = body.byCategory.find(
      (c: { category: string; account_type: string }) =>
        c.category === 'bank' && c.account_type === 'asset'
    )
    expect(bank.total).toBe(15000)
    const cc = body.byCategory.find((c: { category: string }) => c.category === 'credit_card')
    expect(cc.total).toBe(200)
  })

  it('changeSinceSnapshot is null when no prior snapshots', async () => {
    setupTables({
      entries: [makeEntry({ account_type: 'asset', balance: 100 })],
    })
    const res = await getNetWorth()
    const body = await res.json()
    expect(body.changeSinceSnapshot).toBeNull()
    expect(body.latestSnapshot).toBeNull()
  })

  it('changeSinceSnapshot equals netWorth - latestSnapshot.net_worth', async () => {
    setupTables({
      entries: [makeEntry({ account_type: 'asset', balance: 1000 })],
      snapshots: [
        {
          id: 'snap-1',
          snapshot_date: '2026-04-01',
          total_assets: 800,
          total_liabilities: 300,
          net_worth: 500,
          breakdown: null,
          notes: null,
          created_at: '2026-04-01T12:00:00Z',
        },
      ],
    })
    const res = await getNetWorth()
    const body = await res.json()
    expect(body.netWorth).toBe(1000)
    expect(body.latestSnapshot.net_worth).toBe(500)
    expect(body.changeSinceSnapshot).toBe(500)
  })
})

describe('POST /api/net-worth/snapshot', () => {
  it('returns 401 when no user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    setupTables({})
    const res = await postSnapshot(
      new Request('http://localhost/api/net-worth/snapshot', { method: 'POST' })
    )
    expect(res.status).toBe(401)
  })

  it('inserts a snapshot with totals matching live entries', async () => {
    setupTables({
      entries: [
        makeEntry({ account_type: 'asset', category: 'bank', balance: 10000 }),
        makeEntry({ account_type: 'liability', category: 'loan', balance: 3000 }),
      ],
      insertResult: {
        id: 'new-snap',
        snapshot_date: '2026-05-06',
        total_assets: 10000,
        total_liabilities: 3000,
        net_worth: 7000,
        breakdown: null,
        notes: null,
        created_at: '2026-05-06T12:00:00Z',
      },
    })
    const res = await postSnapshot(
      new Request('http://localhost/api/net-worth/snapshot', { method: 'POST' })
    )
    expect(res.status).toBe(200)
    expect(insertCapture.row).toBeTruthy()
    const captured = insertCapture.row as Record<string, unknown>
    expect(captured.total_assets).toBe(10000)
    expect(captured.total_liabilities).toBe(3000)
    expect(captured.net_worth).toBe(7000)
  })

  it('rejects notes longer than 500 chars', async () => {
    setupTables({})
    const res = await postSnapshot(
      new Request('http://localhost/api/net-worth/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'x'.repeat(501) }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('trims notes and treats empty as null', async () => {
    setupTables({
      entries: [makeEntry({ account_type: 'asset', balance: 1 })],
      insertResult: {
        id: 's',
        snapshot_date: '2026-05-06',
        total_assets: 1,
        total_liabilities: 0,
        net_worth: 1,
        breakdown: null,
        notes: null,
        created_at: 'x',
      },
    })
    const res = await postSnapshot(
      new Request('http://localhost/api/net-worth/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: '   ' }),
      })
    )
    expect(res.status).toBe(200)
    expect((insertCapture.row as Record<string, unknown>).notes).toBeNull()
  })
})

describe('GET /api/net-worth/history', () => {
  it('returns 401 when no user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    setupTables({})
    const res = await getHistory(new Request('http://localhost/api/net-worth/history'))
    expect(res.status).toBe(401)
  })

  it('caps limit at 120', async () => {
    const state = setupTables({})
    const res = await getHistory(new Request('http://localhost/api/net-worth/history?limit=999'))
    expect(res.status).toBe(200)
    expect(state.capturedHistoryLimit).toBe(120)
  })

  it('rejects non-positive or non-numeric limits', async () => {
    setupTables({})
    const zero = await getHistory(new Request('http://localhost/api/net-worth/history?limit=0'))
    expect(zero.status).toBe(400)
    const neg = await getHistory(new Request('http://localhost/api/net-worth/history?limit=-5'))
    expect(neg.status).toBe(400)
    const nan = await getHistory(new Request('http://localhost/api/net-worth/history?limit=abc'))
    expect(nan.status).toBe(400)
  })

  it('returns snapshots in ascending date order (DB returns DESC, route reverses)', async () => {
    setupTables({
      snapshots: [
        {
          id: 'b',
          snapshot_date: '2026-04-01',
          total_assets: 1,
          total_liabilities: 0,
          net_worth: 1,
          breakdown: null,
          notes: null,
          created_at: 'x',
        },
        {
          id: 'a',
          snapshot_date: '2026-03-01',
          total_assets: 1,
          total_liabilities: 0,
          net_worth: 1,
          breakdown: null,
          notes: null,
          created_at: 'x',
        },
      ],
    })
    const res = await getHistory(new Request('http://localhost/api/net-worth/history'))
    const body = await res.json()
    expect(body.snapshots[0].id).toBe('a')
    expect(body.snapshots[1].id).toBe('b')
  })
})
