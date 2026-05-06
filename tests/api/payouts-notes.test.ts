/**
 * Tests for app/api/payouts/[id]/notes/route.ts (PATCH).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockUpdate, mockGetUser } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockGetUser: vi.fn(
    (): Promise<{ data: { user: { id: string } | null } }> =>
      Promise.resolve({ data: { user: { id: 'user-1' } } })
  ),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: () => ({
        update: (row: Record<string, unknown>) => ({
          eq: () => ({
            select: () => ({
              single: () => mockUpdate(row),
            }),
          }),
        }),
      }),
    })
  ),
}))

import { PATCH } from '@/app/api/payouts/[id]/notes/route'

beforeEach(() => {
  mockUpdate.mockReset()
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
})

function req(body: unknown): Request {
  return new Request('http://localhost/api/payouts/abc/notes', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('PATCH /api/payouts/[id]/notes — auth', () => {
  it('returns 401 when no user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await PATCH(req({ notes: 'hi' }), params('abc'))
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/payouts/[id]/notes — validation', () => {
  it('returns 400 when body is invalid JSON', async () => {
    const res = await PATCH(req('not json'), params('abc'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when notes is non-string non-null', async () => {
    const res = await PATCH(req({ notes: 123 }), params('abc'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when notes exceeds 500 chars', async () => {
    const res = await PATCH(req({ notes: 'x'.repeat(501) }), params('abc'))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/500/)
  })

  it('accepts notes exactly at 500 chars', async () => {
    mockUpdate.mockResolvedValueOnce({
      data: { id: 'abc', notes: 'x'.repeat(500) },
      error: null,
    })
    const res = await PATCH(req({ notes: 'x'.repeat(500) }), params('abc'))
    expect(res.status).toBe(200)
  })
})

describe('PATCH /api/payouts/[id]/notes — happy paths', () => {
  it('saves trimmed notes and returns updated row', async () => {
    let captured: Record<string, unknown> | undefined
    mockUpdate.mockImplementationOnce((row: Record<string, unknown>) => {
      captured = row
      return Promise.resolve({
        data: { id: 'abc', notes: 'matches AMZN-123' },
        error: null,
      })
    })
    const res = await PATCH(req({ notes: '  matches AMZN-123  ' }), params('abc'))
    expect(res.status).toBe(200)
    expect(captured).toEqual({ notes: 'matches AMZN-123' })
    const body = (await res.json()) as { id: string; notes: string }
    expect(body.id).toBe('abc')
    expect(body.notes).toBe('matches AMZN-123')
  })

  it('clears notes when value is null', async () => {
    let captured: Record<string, unknown> | undefined
    mockUpdate.mockImplementationOnce((row: Record<string, unknown>) => {
      captured = row
      return Promise.resolve({ data: { id: 'abc', notes: null }, error: null })
    })
    const res = await PATCH(req({ notes: null }), params('abc'))
    expect(res.status).toBe(200)
    expect(captured).toEqual({ notes: null })
  })

  it('clears notes when value is empty string after trim', async () => {
    let captured: Record<string, unknown> | undefined
    mockUpdate.mockImplementationOnce((row: Record<string, unknown>) => {
      captured = row
      return Promise.resolve({ data: { id: 'abc', notes: null }, error: null })
    })
    const res = await PATCH(req({ notes: '   ' }), params('abc'))
    expect(res.status).toBe(200)
    expect(captured).toEqual({ notes: null })
  })
})

describe('PATCH /api/payouts/[id]/notes — not found', () => {
  it('returns 404 when settlement does not exist (PGRST116)', async () => {
    mockUpdate.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    })
    const res = await PATCH(req({ notes: 'x' }), params('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on other DB errors', async () => {
    mockUpdate.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate' },
    })
    const res = await PATCH(req({ notes: 'x' }), params('abc'))
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/payouts/[id]/notes — id required', () => {
  it('returns 400 when id is empty string', async () => {
    const res = await PATCH(req({ notes: 'x' }), params(''))
    expect(res.status).toBe(400)
  })
})
