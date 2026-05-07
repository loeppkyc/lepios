/**
 * Tests for app/api/life-milestones/route.ts (GET/POST/PATCH/DELETE).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom, mockGetUser, captures } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(
    (): Promise<{ data: { user: { id: string } | null } }> =>
      Promise.resolve({ data: { user: { id: 'user-1' } } })
  ),
  captures: { insert: null as unknown, update: null as unknown, deleteId: null as unknown },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    })
  ),
}))

import { GET, POST, PATCH, DELETE } from '@/app/api/life-milestones/route'

beforeEach(() => {
  mockFrom.mockReset()
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  captures.insert = null
  captures.update = null
  captures.deleteId = null
})

interface SuiteState {
  list?: unknown[]
  insertResult?: unknown
  updateResult?: unknown
  updateError?: { code?: string; message: string }
}

function setupTable(state: SuiteState) {
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'life_milestones') throw new Error(`unmocked: ${table}`)
    return {
      select: () => ({
        order: () => Promise.resolve({ data: state.list ?? [], error: null }),
      }),
      insert: (row: unknown) => {
        captures.insert = row
        return {
          select: () => ({
            single: () => Promise.resolve({ data: state.insertResult ?? null, error: null }),
          }),
        }
      },
      update: (row: unknown) => {
        captures.update = row
        return {
          eq: () => ({
            select: () => ({
              single: () =>
                Promise.resolve(
                  state.updateError
                    ? { data: null, error: state.updateError }
                    : { data: state.updateResult ?? null, error: null }
                ),
            }),
          }),
        }
      },
      delete: () => ({
        eq: (_col: string, id: string) => {
          captures.deleteId = id
          return Promise.resolve({ error: null })
        },
      }),
    }
  })
}

describe('GET /api/life-milestones', () => {
  it('returns 401 when no user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    setupTable({})
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns rows with numeric money_impact (or null)', async () => {
    setupTable({
      list: [
        {
          id: '1',
          milestone_date: '2026-04-13',
          category: 'debt',
          title: 'Tesla paid off',
          description: null,
          money_impact: '40000',
          created_at: 'x',
          updated_at: 'x',
        },
        {
          id: '2',
          milestone_date: '2026-05-06',
          category: 'family',
          title: 'Apartment upgrade',
          description: null,
          money_impact: null,
          created_at: 'x',
          updated_at: 'x',
        },
      ],
    })
    const res = await GET()
    const body = await res.json()
    expect(body.milestones[0].money_impact).toBe(40000)
    expect(body.milestones[1].money_impact).toBeNull()
  })
})

describe('POST /api/life-milestones', () => {
  it('rejects missing milestone_date', async () => {
    setupTable({})
    const res = await POST(
      new Request('http://localhost/api/life-milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'debt', title: 'x' }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects invalid category', async () => {
    setupTable({})
    const res = await POST(
      new Request('http://localhost/api/life-milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestone_date: '2026-05-06',
          category: 'bogus',
          title: 'x',
        }),
      })
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/category/)
  })

  it('rejects empty title', async () => {
    setupTable({})
    const res = await POST(
      new Request('http://localhost/api/life-milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestone_date: '2026-05-06',
          category: 'debt',
          title: '   ',
        }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('inserts a row and returns it', async () => {
    setupTable({
      insertResult: {
        id: 'new',
        milestone_date: '2026-05-06',
        category: 'debt',
        title: 'Tesla paid off',
        description: null,
        money_impact: '40000',
        created_at: 'x',
        updated_at: 'x',
      },
    })
    const res = await POST(
      new Request('http://localhost/api/life-milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestone_date: '2026-05-06',
          category: 'debt',
          title: '  Tesla paid off  ',
          money_impact: 40000,
        }),
      })
    )
    expect(res.status).toBe(200)
    const captured = captures.insert as Record<string, unknown>
    expect(captured.title).toBe('Tesla paid off')
    expect(captured.money_impact).toBe(40000)
  })

  it('accepts null/empty money_impact and stores null', async () => {
    setupTable({
      insertResult: {
        id: 'new',
        milestone_date: '2026-05-06',
        category: 'family',
        title: 'Apartment',
        description: null,
        money_impact: null,
        created_at: 'x',
        updated_at: 'x',
      },
    })
    const res = await POST(
      new Request('http://localhost/api/life-milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestone_date: '2026-05-06',
          category: 'family',
          title: 'Apartment',
          money_impact: '',
        }),
      })
    )
    expect(res.status).toBe(200)
    expect((captures.insert as Record<string, unknown>).money_impact).toBeNull()
  })
})

describe('PATCH /api/life-milestones', () => {
  it('rejects missing id', async () => {
    setupTable({})
    const res = await PATCH(
      new Request('http://localhost/api/life-milestones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x' }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when not found', async () => {
    setupTable({
      updateError: { code: 'PGRST116', message: 'no rows' },
    })
    const res = await PATCH(
      new Request('http://localhost/api/life-milestones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'nope', title: 'updated' }),
      })
    )
    expect(res.status).toBe(404)
  })

  it('updates description and money_impact', async () => {
    setupTable({
      updateResult: {
        id: 'abc',
        milestone_date: '2026-05-06',
        category: 'debt',
        title: 'x',
        description: 'updated desc',
        money_impact: '12345',
        created_at: 'x',
        updated_at: 'y',
      },
    })
    const res = await PATCH(
      new Request('http://localhost/api/life-milestones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'abc',
          description: 'updated desc',
          money_impact: 12345,
        }),
      })
    )
    expect(res.status).toBe(200)
    const captured = captures.update as Record<string, unknown>
    expect(captured.description).toBe('updated desc')
    expect(captured.money_impact).toBe(12345)
  })
})

describe('DELETE /api/life-milestones', () => {
  it('rejects missing id', async () => {
    setupTable({})
    const res = await DELETE(new Request('http://localhost/api/life-milestones'))
    expect(res.status).toBe(400)
  })

  it('removes row by id', async () => {
    setupTable({})
    const res = await DELETE(new Request('http://localhost/api/life-milestones?id=abc'))
    expect(res.status).toBe(200)
    expect(captures.deleteId).toBe('abc')
  })
})
