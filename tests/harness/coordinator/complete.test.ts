/**
 * Tests for POST /api/coordinator/complete
 *
 * Verifies: auth gate, task_id required, status update, halt check, loop-to-next.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/harness/pickup-runner', () => ({
  onTaskComplete: vi.fn().mockResolvedValue(undefined),
}))

const mockFetch = vi.fn().mockResolvedValue({ ok: true })
vi.stubGlobal('fetch', mockFetch)

import { createServiceClient } from '@/lib/supabase/service'
import { onTaskComplete } from '@/lib/harness/pickup-runner'

// ── Fake DB builders ──────────────────────────────────────────────────────────

function makeDb(haltedValue = 'false', queueCount = 0) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'task_queue') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              count: queueCount,
            })),
          })),
        }
      }
      if (table === 'harness_config') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: { value: haltedValue }, error: null })),
            })),
          })),
        }
      }
      return {} as never
    }),
  } as never
}

function makeRequest(body: unknown, secret = 'test-secret'): Request {
  return new Request('http://localhost/api/coordinator/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/coordinator/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(onTaskComplete).mockResolvedValue(undefined)
    process.env.CRON_SECRET = 'test-secret'
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    mockFetch.mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)
  })

  it('returns 401 on bad auth', async () => {
    const { POST } = await import('@/app/api/coordinator/complete/route')
    const req = makeRequest({ task_id: 'abc' }, 'wrong')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when task_id is missing', async () => {
    const { POST } = await import('@/app/api/coordinator/complete/route')
    const req = makeRequest({})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('marks task complete and returns ok', async () => {
    vi.mocked(createServiceClient).mockReturnValue(makeDb())
    const { POST } = await import('@/app/api/coordinator/complete/route')
    const req = makeRequest({ task_id: 'task-001' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('does not loop when HARNESS_HALTED=true', async () => {
    vi.mocked(createServiceClient).mockReturnValue(makeDb('true', 3))
    const { POST } = await import('@/app/api/coordinator/complete/route')
    const req = makeRequest({ task_id: 'task-001' })
    const res = await POST(req)
    const body = await res.json()
    expect(body.looped_to_next).toBe(false)
    // fetch (pickup trigger) should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('loops to next when queue has tasks and not halted', async () => {
    vi.mocked(createServiceClient).mockReturnValue(makeDb('false', 2))
    const { POST } = await import('@/app/api/coordinator/complete/route')
    const req = makeRequest({ task_id: 'task-001' })
    const res = await POST(req)
    const body = await res.json()
    expect(body.looped_to_next).toBe(true)
  })

  it('does not loop when queue is empty', async () => {
    vi.mocked(createServiceClient).mockReturnValue(makeDb('false', 0))
    const { POST } = await import('@/app/api/coordinator/complete/route')
    const req = makeRequest({ task_id: 'task-001' })
    const res = await POST(req)
    const body = await res.json()
    expect(body.looped_to_next).toBe(false)
  })
})
