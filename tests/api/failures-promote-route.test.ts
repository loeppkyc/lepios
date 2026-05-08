/**
 * Tests for app/api/failures/promote/route.ts.
 *
 * Mocks DB + auth. Validates: auth gate, validation, lookup, stub generation,
 * agent_events archival.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom, mockRequireUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRequireUser: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))
vi.mock('@/lib/auth/require-user', () => ({
  requireUser: mockRequireUser,
}))

import { POST } from '@/app/api/failures/promote/route'
import { NextResponse } from 'next/server'

beforeEach(() => {
  mockFrom.mockReset()
  mockRequireUser.mockReset()
})

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/failures/promote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeFailureSelect(row: Record<string, unknown> | null) {
  return {
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: row, error: row ? null : { message: 'not found' } }),
      }),
    }),
  }
}

function makeAgentEventsInsertOk() {
  return {
    insert: () => Promise.resolve({ data: null, error: null }),
  }
}

describe('POST /api/failures/promote — auth', () => {
  it('rejects unauthenticated requests', async () => {
    mockRequireUser.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'unauth' }, { status: 401 }),
    })
    const res = await POST(
      makeRequest({ failure_id: VALID_UUID, pattern_signature: { type: 'manual' } })
    )
    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('POST /api/failures/promote — validation', () => {
  beforeEach(() => mockRequireUser.mockResolvedValue({ ok: true }))

  it('rejects invalid JSON', async () => {
    const req = new Request('http://localhost/api/failures/promote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects missing failure_id', async () => {
    const res = await POST(makeRequest({ pattern_signature: { type: 'manual' } }))
    expect(res.status).toBe(400)
  })

  it('rejects non-UUID failure_id', async () => {
    const res = await POST(makeRequest({ failure_id: 'not-a-uuid', pattern_signature: {} }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/failures/promote — happy path', () => {
  beforeEach(() => mockRequireUser.mockResolvedValue({ ok: true }))

  it('returns test_path with failure_number slug when row found', async () => {
    mockFrom
      .mockReturnValueOnce(
        makeFailureSelect({
          failure_number: 'F-N7',
          title: 'Test failure',
          what_happened: 'It broke',
          lesson: 'Always validate',
          pattern_signature: { type: 'test-fail' },
        })
      )
      .mockReturnValueOnce(makeAgentEventsInsertOk())

    const res = await POST(
      makeRequest({
        failure_id: VALID_UUID,
        failure_number: 'F-N7',
        pattern_signature: { type: 'test-fail' },
      })
    )
    const body = (await res.json()) as { ok: boolean; test_path: string; content_preview: string }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.test_path).toBe('tests/regression/f-n7.test.ts')
    expect(body.content_preview).toContain('regression: F-N7')
    expect(body.content_preview).toContain('Test failure')
  })

  it('falls back to id-prefix slug when failure_number is null', async () => {
    mockFrom
      .mockReturnValueOnce(
        makeFailureSelect({
          failure_number: null,
          title: 'Unnumbered',
          what_happened: 'X',
          lesson: null,
          pattern_signature: { type: 'manual' },
        })
      )
      .mockReturnValueOnce(makeAgentEventsInsertOk())

    const res = await POST(
      makeRequest({ failure_id: VALID_UUID, pattern_signature: { type: 'manual' } })
    )
    const body = (await res.json()) as { ok: boolean; test_path: string }
    expect(body.test_path).toMatch(/^tests\/regression\/[a-f0-9]{8}\.test\.ts$/)
  })

  it('writes agent_events row with stub content', async () => {
    let insertedRow: Record<string, unknown> | null = null
    mockFrom
      .mockReturnValueOnce(
        makeFailureSelect({
          failure_number: 'F-N5',
          title: 'auth leak',
          what_happened: 'pub',
          lesson: 'gate it',
          pattern_signature: { type: 'auth-leak' },
        })
      )
      .mockReturnValueOnce({
        insert: (row: Record<string, unknown>) => {
          insertedRow = row
          return Promise.resolve({ data: null, error: null })
        },
      })

    await POST(
      makeRequest({
        failure_id: VALID_UUID,
        failure_number: 'F-N5',
        pattern_signature: { type: 'auth-leak' },
      })
    )
    expect(insertedRow).not.toBeNull()
    const r = insertedRow as Record<string, unknown>
    expect(r.action).toBe('failures_log.promote_to_test')
    expect(r.domain).toBe('failures_log')
    const meta = r.meta as Record<string, unknown>
    expect(meta.test_path).toBe('tests/regression/f-n5.test.ts')
    expect(typeof meta.content).toBe('string')
    expect((meta.content as string).length).toBeGreaterThan(50)
  })
})

describe('POST /api/failures/promote — failure not found', () => {
  beforeEach(() => mockRequireUser.mockResolvedValue({ ok: true }))

  it('returns 404 when row missing', async () => {
    mockFrom.mockReturnValueOnce(makeFailureSelect(null))
    const res = await POST(
      makeRequest({ failure_id: VALID_UUID, pattern_signature: { type: 'manual' } })
    )
    expect(res.status).toBe(404)
  })
})
