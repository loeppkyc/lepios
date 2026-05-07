/**
 * Unit tests for app/api/cron/night-tick/route.ts night_watchman wire-up.
 *
 * Companion to PR #112 hotfix that deleted the standalone night_watchman_scan cron
 * to fit the Vercel Hobby 18-cron limit. The scanner is now invoked from inside the
 * existing /api/cron/night-tick route as a non-fatal third pass.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockFrom, mockRunNightTick, mockRunSandboxGc, mockRunScan } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRunNightTick: vi.fn(),
  mockRunSandboxGc: vi.fn(),
  mockRunScan: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))
vi.mock('@/lib/orchestrator/tick', () => ({
  runNightTick: mockRunNightTick,
}))
vi.mock('@/lib/harness/sandbox/gc', () => ({
  runSandboxGc: mockRunSandboxGc,
}))
vi.mock('@/lib/night_watchman', () => ({
  runScan: mockRunScan,
  scopeForNow: vi.fn(() => 'sleep_window'),
}))

import { GET } from '@/app/api/cron/night-tick/route'

const VALID_SECRET = 'test-cron-secret-1234567890'

function authedRequest(): Request {
  return new Request('http://localhost/api/cron/night-tick', {
    headers: { authorization: `Bearer ${VALID_SECRET}` },
  })
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  process.env.CRON_SECRET = VALID_SECRET
  mockFrom.mockReset()
  mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })
  mockRunNightTick.mockReset()
  mockRunNightTick.mockResolvedValue({
    tick_id: 't1',
    run_id: 'r1',
    mode: 'overnight_readonly',
    checks: [],
    duration_ms: 100,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: 'completed',
  })
  mockRunSandboxGc.mockReset()
  mockRunSandboxGc.mockResolvedValue({ swept: 0, errors: 0 })
  mockRunScan.mockReset()
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('night-tick — night_watchman wire-up', () => {
  it('invokes runScan with cron triggerSource and current scope', async () => {
    mockRunScan.mockResolvedValue({
      runId: 'nw-1',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      scope: 'sleep_window',
      totalChecks: 5,
      totalRepairs: 0,
      totalIncidents: 0,
      totalEscalations: 0,
      halted: false,
      results: [],
      repairs: [],
    })

    const res = await GET(authedRequest())
    expect(res.status).toBe(200)
    expect(mockRunScan).toHaveBeenCalledOnce()
    const callArgs = mockRunScan.mock.calls[0][0]
    expect(callArgs.triggerSource).toBe('cron')
    expect(callArgs.scope).toBe('sleep_window')
    expect(callArgs.dryRun).toBeUndefined() // production scan, not dry-run
  })

  it('includes night_watchman summary in response body', async () => {
    mockRunScan.mockResolvedValue({
      runId: 'nw-2',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      scope: 'sleep_window',
      totalChecks: 8,
      totalRepairs: 1,
      totalIncidents: 1,
      totalEscalations: 0,
      halted: false,
      results: [],
      repairs: [],
    })

    const res = await GET(authedRequest())
    const body = await res.json()
    expect(body.night_watchman).toEqual({
      run_id: 'nw-2',
      scope: 'sleep_window',
      total_checks: 8,
      total_repairs: 1,
      total_escalations: 0,
      halted: false,
    })
  })

  it('does NOT fail the route if runScan throws (non-fatal pattern)', async () => {
    mockRunScan.mockRejectedValue(new Error('check failed catastrophically'))

    const res = await GET(authedRequest())
    expect(res.status).toBe(200) // route still returns 200 — night-tick succeeded
    const body = await res.json()
    expect(body.night_watchman.error).toContain('check failed catastrophically')
  })

  it('logs scan failure to agent_events', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({ insert: insertMock })
    mockRunScan.mockRejectedValue(new Error('runScan exploded'))

    await GET(authedRequest())

    const nightWatchmanCall = insertMock.mock.calls.find(
      (call) => call[0]?.domain === 'night_watchman'
    )
    expect(nightWatchmanCall).toBeDefined()
    expect(nightWatchmanCall![0]).toMatchObject({
      domain: 'night_watchman',
      action: 'night_watchman.scan_failed',
      actor: 'night_tick',
      status: 'error',
    })
    expect(nightWatchmanCall![0].error_message).toContain('runScan exploded')
  })

  it('returns 401 on missing CRON_SECRET', async () => {
    const res = await GET(
      new Request('http://localhost/api/cron/night-tick', {
        headers: { authorization: 'Bearer wrong' },
      })
    )
    expect(res.status).toBe(401)
    expect(mockRunScan).not.toHaveBeenCalled()
  })
})
