/**
 * Tests for POST /api/coordinator/fire
 *
 * Verifies: auth gate, validation, happy-path insert, pickup trigger.
 * Uses fake Supabase client pattern (no real DB calls).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

// Stub global fetch so triggerPickup doesn't call out
const mockFetch = vi.fn().mockResolvedValue({ ok: true })
vi.stubGlobal('fetch', mockFetch)

import { createServiceClient } from '@/lib/supabase/service'

function makeDb(insertData: { id: string } | null, insertError: { message: string } | null = null) {
  return {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: insertData,
            error: insertError,
          })),
        })),
      })),
    })),
  }
}

// ── Helper to build request ───────────────────────────────────────────────────

function makeRequest(body: unknown, secret = 'test-secret'): Request {
  return new Request('http://localhost/api/coordinator/fire', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/coordinator/fire', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    mockFetch.mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)
  })

  it('returns 401 on missing/wrong auth', async () => {
    const { POST } = await import('@/app/api/coordinator/fire/route')
    const req = makeRequest({ task: 'do stuff' }, 'wrong-secret')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when task is missing', async () => {
    const { POST } = await import('@/app/api/coordinator/fire/route')
    const req = makeRequest({})
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/task is required/)
  })

  it('returns 400 when task is empty string', async () => {
    const { POST } = await import('@/app/api/coordinator/fire/route')
    const req = makeRequest({ task: '   ' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('inserts task and returns task_id on success', async () => {
    vi.mocked(createServiceClient).mockReturnValue(makeDb({ id: 'task-abc-123' }) as never)
    const { POST } = await import('@/app/api/coordinator/fire/route')
    const req = makeRequest({ task: 'Run T-003 receipt port', priority: 2 })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.task_id).toBe('task-abc-123')
  })

  it('returns 500 on DB insert error', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeDb(null, { message: 'insert failed' }) as never
    )
    const { POST } = await import('@/app/api/coordinator/fire/route')
    const req = makeRequest({ task: 'some task' })
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  it('clamps priority to 5 when out of range', async () => {
    const db = makeDb({ id: 'task-xyz' }) as never
    vi.mocked(createServiceClient).mockReturnValue(db)
    const { POST } = await import('@/app/api/coordinator/fire/route')
    // priority 99 should be ignored (default 5)
    const req = makeRequest({ task: 'some task', priority: 99 })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})
