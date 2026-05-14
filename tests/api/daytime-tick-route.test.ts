/**
 * Tests for app/api/cron/daytime-tick/route.ts
 *
 * Covers:
 *   AC-2: Unauthorized requests are rejected (no CRON_SECRET header → 401)
 *   AC-8: Feature flag gates the tick completely (DAYTIME_TICK_ENABLED unset → 200 + disabled body)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock runDaytimeTick ───────────────────────────────────────────────────────

const { mockRunDaytimeTick } = vi.hoisted(() => ({ mockRunDaytimeTick: vi.fn() }))

vi.mock('@/lib/orchestrator/daytime-tick', () => ({
  runDaytimeTick: mockRunDaytimeTick,
}))

// ── Mock upsertHeartbeat ──────────────────────────────────────────────────────

vi.mock('@/lib/orchestrator/heartbeat', () => ({
  upsertHeartbeat: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from '@/app/api/cron/daytime-tick/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CRON_SECRET = 'test-daytime-secret'

function makeRequest(secret: string | null = CRON_SECRET): Request {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['Authorization'] = `Bearer ${secret}`
  return new Request('http://localhost/api/cron/daytime-tick', {
    method: 'GET',
    headers,
  })
}

const MOCK_DAYTIME_RESULT = {
  tick_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  run_id: 'bbbbbbbb-0000-0000-0000-000000000002',
  mode: 'daytime_ollama',
  status: 'completed',
  checks: [],
  duration_ms: 5000,
  started_at: '2026-05-14T18:00:00.000Z',
  finished_at: '2026-05-14T18:00:05.000Z',
  tunnel_used: false,
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  process.env.DAYTIME_TICK_ENABLED = '1'
  mockRunDaytimeTick.mockResolvedValue(MOCK_DAYTIME_RESULT)
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.DAYTIME_TICK_ENABLED
})

// ── AC-2: Unauthorized requests are rejected ──────────────────────────────────

describe('daytime-tick route — auth (AC-2)', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    const req = makeRequest(null)
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when wrong Bearer token is provided', async () => {
    const req = makeRequest('wrong-secret')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('does not call runDaytimeTick on unauthorized requests', async () => {
    const req = makeRequest(null)
    await GET(req)
    expect(mockRunDaytimeTick).not.toHaveBeenCalled()
  })

  it('returns 200 when correct Bearer token is provided', async () => {
    const req = makeRequest(CRON_SECRET)
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})

// ── AC-8: Feature flag gates the tick completely ──────────────────────────────

describe('daytime-tick route — feature flag (AC-8)', () => {
  it('returns 200 with disabled body when DAYTIME_TICK_ENABLED is unset', async () => {
    delete process.env.DAYTIME_TICK_ENABLED
    const req = makeRequest(CRON_SECRET)
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; reason: string; duration_ms: number }
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('daytime-tick-disabled')
    expect(body.duration_ms).toBe(0)
  })

  it('does not call runDaytimeTick when feature flag is unset', async () => {
    delete process.env.DAYTIME_TICK_ENABLED
    const req = makeRequest(CRON_SECRET)
    await GET(req)
    expect(mockRunDaytimeTick).not.toHaveBeenCalled()
  })

  it('calls runDaytimeTick when DAYTIME_TICK_ENABLED is set to 1', async () => {
    process.env.DAYTIME_TICK_ENABLED = '1'
    const req = makeRequest(CRON_SECRET)
    await GET(req)
    expect(mockRunDaytimeTick).toHaveBeenCalledTimes(1)
  })

  it('calls runDaytimeTick when DAYTIME_TICK_ENABLED is set to true', async () => {
    process.env.DAYTIME_TICK_ENABLED = 'true'
    const req = makeRequest(CRON_SECRET)
    await GET(req)
    expect(mockRunDaytimeTick).toHaveBeenCalledTimes(1)
  })

  it('returns tick result JSON in body when feature is enabled', async () => {
    const req = makeRequest(CRON_SECRET)
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      tick_id: MOCK_DAYTIME_RESULT.tick_id,
      mode: 'daytime_ollama',
      status: 'completed',
    })
  })
})
