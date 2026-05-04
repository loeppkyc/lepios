/**
 * Unit tests for POST /api/memory/idea.
 * Covers: auth gate, validation, happy path, DB error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/auth/cron-secret', () => ({
  requireCronSecret: vi.fn(() => null), // authorized by default
}))

import { POST } from '@/app/api/memory/idea/route'
import { requireCronSecret } from '@/lib/auth/cron-secret'

function makeRequest(body: unknown, auth = true) {
  return new Request('http://localhost/api/memory/idea', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { authorization: 'Bearer test-secret' } : {}),
    },
    body: JSON.stringify(body),
  })
}

function makeInsertBuilder(id: string | null, status = 'parked', error: Error | null = null) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: id ? { id, status } : null, error }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireCronSecret).mockReturnValue(null)
})

describe('POST /api/memory/idea', () => {
  it('returns 401 when unauthorized', async () => {
    const { NextResponse } = await import('next/server')
    vi.mocked(requireCronSecret).mockReturnValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )
    const res = await POST(makeRequest({ title: 'test', source: 'manual_api' }, false))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new Request('http://localhost/api/memory/idea', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer x' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Invalid JSON')
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(makeRequest({ body: 'no title or source' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
  })

  it('returns 400 for invalid source enum', async () => {
    const res = await POST(makeRequest({ title: 'test', source: 'not_a_source' }))
    expect(res.status).toBe(400)
  })

  it('returns 201 with id and status on success', async () => {
    mockFrom.mockReturnValueOnce(makeInsertBuilder('idea-uuid-1', 'parked'))
    const res = await POST(makeRequest({ title: 'Great idea', source: 'manual_api' }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.id).toBe('idea-uuid-1')
    expect(json.status).toBe('parked')
  })

  it('accepts all optional fields', async () => {
    mockFrom.mockReturnValueOnce(makeInsertBuilder('idea-uuid-2', 'active'))
    const res = await POST(
      makeRequest({
        title: 'Full idea',
        body: 'Long description',
        summary: 'Short summary',
        source: 'manual_api',
        source_ref: 'session-abc',
        tags: ['twin', 'autonomy'],
        score: 0.9,
        status: 'active',
      }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.id).toBe('idea-uuid-2')
  })

  it('returns 500 on DB error', async () => {
    mockFrom.mockReturnValueOnce(makeInsertBuilder(null, 'parked', new Error('db error')))
    const res = await POST(makeRequest({ title: 'test', source: 'scout_agent' }))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })
})
