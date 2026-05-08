/**
 * Tests for app/api/failures/log/route.ts (POST handler).
 *
 * Mocks logFailure + auth gates. Validates: auth (cron-secret + user),
 * input validation (zod), signature_input → buildSignature path,
 * pre-built pattern_signature path, error responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockLogFailure, mockRequireCronSecret, mockRequireUser } = vi.hoisted(() => ({
  mockLogFailure: vi.fn(),
  mockRequireCronSecret: vi.fn(),
  mockRequireUser: vi.fn(),
}))

vi.mock('@/lib/failures/log', () => ({
  logFailure: mockLogFailure,
}))

vi.mock('@/lib/auth/cron-secret', () => ({
  requireCronSecret: mockRequireCronSecret,
}))

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: mockRequireUser,
}))

import { POST } from '@/app/api/failures/log/route'
import { NextResponse } from 'next/server'

beforeEach(() => {
  mockLogFailure.mockReset()
  mockRequireCronSecret.mockReset()
  mockRequireUser.mockReset()
})

function makeRequest(body: unknown, withAuth = true): Request {
  return new Request('http://localhost/api/failures/log', {
    method: 'POST',
    headers: withAuth
      ? { 'content-type': 'application/json', authorization: 'Bearer test-secret' }
      : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/failures/log — auth', () => {
  it('accepts cron-secret authentication', async () => {
    mockRequireCronSecret.mockReturnValueOnce(null) // null = authorized
    mockLogFailure.mockResolvedValueOnce({
      ok: true,
      id: 'uuid-1',
      failure_number: 'F-N1',
      status: 'open',
      is_recurrence: false,
    })

    const res = await POST(
      makeRequest({
        title: 'Test',
        trigger_context: 'manual',
        what_happened: 'Something',
        signature_input: { type: 'manual' },
      })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.auth_mode).toBe('cron')
    expect(mockRequireUser).not.toHaveBeenCalled()
  })

  it('falls back to user auth when cron-secret rejected', async () => {
    mockRequireCronSecret.mockReturnValueOnce(
      NextResponse.json({ error: 'no secret' }, { status: 401 })
    )
    mockRequireUser.mockResolvedValueOnce({ ok: true })
    mockLogFailure.mockResolvedValueOnce({
      ok: true,
      id: 'uuid-2',
      failure_number: 'F-N2',
      status: 'open',
      is_recurrence: false,
    })

    const res = await POST(
      makeRequest({
        title: 'Manual entry',
        trigger_context: 'manual',
        what_happened: 'Colin found this',
        signature_input: { type: 'manual' },
      })
    )
    const body = await res.json()
    expect(body.auth_mode).toBe('user')
  })

  it('rejects when both auth modes fail', async () => {
    mockRequireCronSecret.mockReturnValueOnce(
      NextResponse.json({ error: 'no secret' }, { status: 401 })
    )
    mockRequireUser.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    })

    const res = await POST(
      makeRequest({
        title: 'X',
        trigger_context: 'manual',
        what_happened: 'Y',
        signature_input: { type: 'manual' },
      })
    )
    expect(res.status).toBe(401)
    expect(mockLogFailure).not.toHaveBeenCalled()
  })
})

describe('POST /api/failures/log — input validation', () => {
  beforeEach(() => {
    mockRequireCronSecret.mockReturnValue(null)
  })

  it('rejects invalid JSON body', async () => {
    const req = new Request('http://localhost/api/failures/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/JSON/)
  })

  it('rejects body missing required fields', async () => {
    const res = await POST(makeRequest({ title: 'X' }))
    expect(res.status).toBe(400)
  })

  it('rejects body with neither signature_input nor pattern_signature', async () => {
    const res = await POST(
      makeRequest({
        title: 'X',
        trigger_context: 'manual',
        what_happened: 'Y',
      })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/signature_input or pattern_signature/)
  })

  it('rejects invalid trigger_context value', async () => {
    const res = await POST(
      makeRequest({
        title: 'X',
        trigger_context: 'bogus',
        what_happened: 'Y',
        signature_input: { type: 'manual' },
      })
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/failures/log — success paths', () => {
  beforeEach(() => {
    mockRequireCronSecret.mockReturnValue(null)
  })

  it('builds signature from signature_input and calls logFailure', async () => {
    mockLogFailure.mockResolvedValueOnce({
      ok: true,
      id: 'uuid-1',
      failure_number: 'F-N1',
      status: 'open',
      is_recurrence: false,
    })

    const res = await POST(
      makeRequest({
        title: 'New failure',
        trigger_context: 'self_repair',
        what_happened: 'Detector caught it',
        signature_input: {
          type: 'route-500',
          files: ['app/api/foo/route.ts'],
          error_message: 'TypeError: undefined.x',
        },
      })
    )

    expect(res.status).toBe(200)
    expect(mockLogFailure).toHaveBeenCalledOnce()
    const callArg = mockLogFailure.mock.calls[0][0]
    expect(callArg.pattern_signature.type).toBe('route-500')
    expect(callArg.pattern_signature.error_class).toBe('TypeError')
    expect(callArg.pattern_signature.touched_files).toEqual(['app/api/foo/route.ts'])
  })

  it('uses pre-built pattern_signature when provided', async () => {
    mockLogFailure.mockResolvedValueOnce({
      ok: true,
      id: 'uuid-3',
      failure_number: 'F-N3',
      status: 'open',
      is_recurrence: false,
    })

    const presignature = { type: 'silent-skip' as const, keywords: ['n8n', 'webhook'] }
    const res = await POST(
      makeRequest({
        title: 'Silent skip',
        trigger_context: 'manual',
        what_happened: 'n8n skipped',
        pattern_signature: presignature,
      })
    )

    expect(res.status).toBe(200)
    const callArg = mockLogFailure.mock.calls[0][0]
    expect(callArg.pattern_signature).toEqual(presignature)
  })

  it('returns is_recurrence flag from logFailure', async () => {
    mockLogFailure.mockResolvedValueOnce({
      ok: true,
      id: 'fixed-uuid',
      failure_number: 'F-N5',
      status: 'recurring',
      is_recurrence: true,
    })

    const res = await POST(
      makeRequest({
        title: 'Recurrence',
        trigger_context: 'pr',
        what_happened: 'Same thing again',
        pattern_signature: { type: 'route-500', error_class: 'TypeError' },
      })
    )
    const body = await res.json()
    expect(body.is_recurrence).toBe(true)
    expect(body.status).toBe('recurring')
  })

  it('returns 500 when logFailure fails', async () => {
    mockLogFailure.mockResolvedValueOnce({ ok: false, error: 'DB unavailable' })

    const res = await POST(
      makeRequest({
        title: 'X',
        trigger_context: 'manual',
        what_happened: 'Y',
        signature_input: { type: 'manual' },
      })
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('DB unavailable')
  })
})
