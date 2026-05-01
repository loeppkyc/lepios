import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock the drain handler so tick tests don't depend on Supabase ─────────────

const { mockDrainGET } = vi.hoisted(() => ({ mockDrainGET: vi.fn() }))

vi.mock('@/app/api/harness/notifications-drain/route', () => ({
  GET: mockDrainGET,
}))

import { GET, POST } from '@/app/api/cron/notifications-drain-tick/route'

const CRON_SECRET = 'test-tick-secret'

function makeAuthorizedRequest(method = 'GET'): Request {
  return new Request('http://localhost/api/cron/notifications-drain-tick', {
    method,
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  mockDrainGET.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, drained: 2, failed: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  )
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('GET /api/cron/notifications-drain-tick — auth', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const req = new Request('http://localhost/api/cron/notifications-drain-tick')
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(mockDrainGET).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header has wrong value', async () => {
    const req = new Request('http://localhost/api/cron/notifications-drain-tick', {
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(mockDrainGET).not.toHaveBeenCalled()
  })

  it('returns 200 when Authorization header is correct (delegates to drain)', async () => {
    const res = await GET(makeAuthorizedRequest())
    expect(res.status).toBe(200)
    expect(mockDrainGET).toHaveBeenCalledOnce()
  })

  it('returns 500 when CRON_SECRET is not configured (F22 fail-closed)', async () => {
    delete process.env.CRON_SECRET
    const req = new Request('http://localhost/api/cron/notifications-drain-tick')
    const res = await GET(req)
    expect(res.status).toBe(500)
  })
})

// ── Delegation ────────────────────────────────────────────────────────────────

describe('GET /api/cron/notifications-drain-tick — delegation', () => {
  it('passes an authorized internal request to the drain handler', async () => {
    await GET(makeAuthorizedRequest())
    expect(mockDrainGET).toHaveBeenCalledOnce()
    const passedReq = mockDrainGET.mock.calls[0][0] as Request
    expect(passedReq.headers.get('authorization')).toBe(`Bearer ${CRON_SECRET}`)
  })

  it('returns drain handler response unchanged', async () => {
    const res = await GET(makeAuthorizedRequest())
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, drained: 2, failed: 0 })
  })

  it('POST method also delegates to drain handler', async () => {
    const res = await POST(makeAuthorizedRequest('POST'))
    expect(res.status).toBe(200)
    expect(mockDrainGET).toHaveBeenCalledOnce()
  })
})
