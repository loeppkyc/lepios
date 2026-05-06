/**
 * Tests for app/api/inventory-snapshots/route.ts (GET/POST/PATCH/DELETE).
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

import { GET, POST, PATCH, DELETE } from '@/app/api/inventory-snapshots/route'

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
  insertError?: { code?: string; message: string }
  updateResult?: unknown
  updateError?: { code?: string; message: string }
}

function setupTable(state: SuiteState) {
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'inventory_snapshots') throw new Error(`unmocked: ${table}`)
    return {
      select: () => ({
        order: () => Promise.resolve({ data: state.list ?? [], error: null }),
      }),
      insert: (row: unknown) => {
        captures.insert = row
        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                state.insertError
                  ? { data: null, error: state.insertError }
                  : { data: state.insertResult ?? null, error: null }
              ),
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
        eq: (col: string, id: string) => {
          captures.deleteId = id
          return Promise.resolve({ error: null })
        },
      }),
    }
  })
}

describe('GET /api/inventory-snapshots', () => {
  it('returns 401 when no user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    setupTable({})
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns rows mapped with numeric value_at_cost', async () => {
    setupTable({
      list: [
        {
          id: '1',
          snapshot_date: '2026-04-30',
          value_at_cost: '45000.00',
          source: 'manual',
          notes: null,
          created_at: 'x',
          updated_at: 'x',
        },
      ],
    })
    const res = await GET()
    const body = await res.json()
    expect(body.snapshots[0].value_at_cost).toBe(45000)
  })
})

describe('POST /api/inventory-snapshots', () => {
  it('rejects missing snapshot_date', async () => {
    setupTable({})
    const res = await POST(
      new Request('http://localhost/api/inventory-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value_at_cost: 100 }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects malformed snapshot_date', async () => {
    setupTable({})
    const res = await POST(
      new Request('http://localhost/api/inventory-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_date: '04/30/2026', value_at_cost: 100 }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects non-finite value_at_cost', async () => {
    setupTable({})
    const res = await POST(
      new Request('http://localhost/api/inventory-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_date: '2026-04-30', value_at_cost: 'abc' }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('returns 409 on unique violation', async () => {
    setupTable({
      insertError: { code: '23505', message: 'duplicate' },
    })
    const res = await POST(
      new Request('http://localhost/api/inventory-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_date: '2026-04-30', value_at_cost: 100 }),
      })
    )
    expect(res.status).toBe(409)
  })

  it('inserts a row with normalized notes', async () => {
    setupTable({
      insertResult: {
        id: 'new',
        snapshot_date: '2026-04-30',
        value_at_cost: '100.00',
        source: 'manual',
        notes: 'hi',
        created_at: 'x',
        updated_at: 'x',
      },
    })
    const res = await POST(
      new Request('http://localhost/api/inventory-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot_date: '2026-04-30',
          value_at_cost: 100,
          notes: '   hi   ',
        }),
      })
    )
    expect(res.status).toBe(200)
    const captured = captures.insert as Record<string, unknown>
    expect(captured.value_at_cost).toBe(100)
    expect(captured.notes).toBe('hi')
  })
})

describe('PATCH /api/inventory-snapshots', () => {
  it('rejects missing id', async () => {
    setupTable({})
    const res = await PATCH(
      new Request('http://localhost/api/inventory-snapshots', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value_at_cost: 100 }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects empty update body', async () => {
    setupTable({})
    const res = await PATCH(
      new Request('http://localhost/api/inventory-snapshots', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'abc' }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when row not found', async () => {
    setupTable({
      updateError: { code: 'PGRST116', message: 'no rows' },
    })
    const res = await PATCH(
      new Request('http://localhost/api/inventory-snapshots', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'nope', value_at_cost: 100 }),
      })
    )
    expect(res.status).toBe(404)
  })

  it('returns 200 on successful update', async () => {
    setupTable({
      updateResult: {
        id: 'abc',
        snapshot_date: '2026-04-30',
        value_at_cost: '50000.00',
        source: 'manual',
        notes: null,
        created_at: 'x',
        updated_at: 'y',
      },
    })
    const res = await PATCH(
      new Request('http://localhost/api/inventory-snapshots', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'abc', value_at_cost: 50000 }),
      })
    )
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/inventory-snapshots', () => {
  it('rejects missing id', async () => {
    setupTable({})
    const res = await DELETE(new Request('http://localhost/api/inventory-snapshots'))
    expect(res.status).toBe(400)
  })

  it('returns 401 when no user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    setupTable({})
    const res = await DELETE(new Request('http://localhost/api/inventory-snapshots?id=abc'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with ok:true on successful delete', async () => {
    setupTable({})
    const res = await DELETE(new Request('http://localhost/api/inventory-snapshots?id=abc'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(captures.deleteId).toBe('abc')
  })
})
