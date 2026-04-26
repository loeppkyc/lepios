/**
 * Tests for lib/harness/deploy-gate.ts (findPreviewDeployment)
 * and app/api/cron/deploy-gate-runner/route.ts (gate runner cron).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const {
  mockInsert,
  mockFrom,
  mockRunRouteHealthSmoke,
  mockRunCronRegistrationSmoke,
  mockApplyBumps,
  mockParseBumpDirectives,
} = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockFrom = vi.fn()
  const mockRunRouteHealthSmoke = vi.fn()
  const mockRunCronRegistrationSmoke = vi.fn()
  const mockApplyBumps = vi.fn().mockResolvedValue([])
  const mockParseBumpDirectives = vi.fn().mockReturnValue([])
  return {
    mockInsert,
    mockFrom,
    mockRunRouteHealthSmoke,
    mockRunCronRegistrationSmoke,
    mockApplyBumps,
    mockParseBumpDirectives,
  }
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/harness/smoke-tests/route-health', () => ({
  runRouteHealthSmoke: mockRunRouteHealthSmoke,
}))

vi.mock('@/lib/harness/smoke-tests/cron-registration', () => ({
  runCronRegistrationSmoke: mockRunCronRegistrationSmoke,
}))

vi.mock('@/lib/harness/component-bump', () => ({
  parseBumpDirectives: mockParseBumpDirectives,
  applyBumps: mockApplyBumps,
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  findPreviewDeployment,
  runSmokeCheck,
  detectMigrations,
  mergeToMain,
  deleteBranch,
  rollbackDeployment,
  sendPromotionNotification,
  fetchMigrationSQL,
  sendMigrationGateMessage,
  insertSmokePendingEvent,
  fetchMainCommits,
} from '@/lib/harness/deploy-gate'
import { GET } from '@/app/api/cron/deploy-gate-runner/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-cron-secret-xyz'

function makeRequest(headerOverrides: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/deploy-gate-runner', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${VALID_SECRET}`,
      ...headerOverrides,
    },
  })
}

// Thenable query builder — supports all Supabase select chain methods.
// Awaiting it resolves to { data, error: null }.
// Also exposes insert: mockInsert for rows that use from().insert().
function makeSelectBuilder(data: unknown[]) {
  const p = Promise.resolve({ data, error: null })
  const b: Record<string, unknown> = {
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
    insert: mockInsert,
  }
  for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit']) {
    b[m] = vi.fn().mockReturnValue(b)
  }
  return b
}

function makeInsertBuilder() {
  return { insert: mockInsert }
}

function makeTriggerRow(commit_sha: string, minsAgo = 5) {
  return {
    id: `evt-${commit_sha}`,
    meta: {
      commit_sha,
      task_id: '00000000-0000-0000-0000-000000000001',
      branch: `harness/task-test-${commit_sha}`,
    },
    occurred_at: new Date(Date.now() - minsAgo * 60 * 1000).toISOString(),
  }
}

function makeVercelDeployment(readyState: string, target = 'preview') {
  return {
    uid: `dpl-${readyState.toLowerCase()}`,
    url: 'preview-abc.vercel.app',
    readyState,
    target,
  }
}

const mockFetch = vi.fn()

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
  process.env.CRON_SECRET = VALID_SECRET
  process.env.VERCEL_TOKEN = 'test-vercel-token'
  process.env.VERCEL_PROJECT_ID = 'prj-test-id'
  process.env.GITHUB_TOKEN = 'test-github-token'
  process.env.DEPLOY_GATE_AUTO_PROMOTE = '0' // disable auto-promote in all baseline tests
  delete process.env.VERCEL_TEAM_ID
  // Default: both production smokes pass — prevents interference with trigger-focused tests
  mockRunRouteHealthSmoke.mockResolvedValue({
    passed: true,
    routes: [],
    failed_routes: [],
    total_ms: 50,
  })
  mockRunCronRegistrationSmoke.mockResolvedValue({
    passed: true,
    reason: '10 crons registered, 0 hourly — Hobby plan compliant',
    details: { hourly_count: 0, schedules: [] },
  })
  // Default: fetchMainCommits returns [] — keeps runBumpSweep a no-op in all baseline tests
  mockFetch.mockResolvedValue({ ok: false, status: 404 })
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.VERCEL_TOKEN
  delete process.env.VERCEL_PROJECT_ID
  delete process.env.GITHUB_TOKEN
  delete process.env.DEPLOY_GATE_AUTO_PROMOTE
  vi.unstubAllGlobals()
})

// ── findPreviewDeployment ─────────────────────────────────────────────────────

describe('findPreviewDeployment', () => {
  it('returns ready with deployment_id and preview_url when Vercel reports READY', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
    })

    const result = await findPreviewDeployment('abc1234')

    expect(result.status).toBe('ready')
    expect(result.deployment_id).toBe('dpl-ready')
    expect(result.preview_url).toBe('https://preview-abc.vercel.app')
    expect(result.ready_state).toBe('READY')
  })

  it('returns building when Vercel reports BUILDING', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deployments: [makeVercelDeployment('BUILDING')] }),
    })

    const result = await findPreviewDeployment('abc1234')

    expect(result.status).toBe('building')
    expect(result.deployment_id).toBe('dpl-building')
  })

  it('returns not_found when deployment list is empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deployments: [] }),
    })

    const result = await findPreviewDeployment('abc1234')

    expect(result.status).toBe('not_found')
  })

  it('filters out production deployments and returns not_found if only production exists', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY', 'production')] }),
    })

    const result = await findPreviewDeployment('abc1234')

    expect(result.status).toBe('not_found')
  })

  it('returns not_found and logs config error when VERCEL_TOKEN is missing', async () => {
    delete process.env.VERCEL_TOKEN
    mockFrom.mockReturnValue(makeInsertBuilder())

    const result = await findPreviewDeployment('abc1234')

    expect(result.status).toBe('not_found')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const row = mockInsert.mock.calls[0][0]
    expect(row.task_type).toBe('deploy_gate_failed')
    expect(row.status).toBe('error')
    expect(row.meta.reason).toBe('config')
    expect(row.meta.commit_sha).toBe('abc1234')
    expect(row.meta.missing).toBe('VERCEL_TOKEN')
  })

  it('returns not_found and logs config error when VERCEL_PROJECT_ID is missing', async () => {
    delete process.env.VERCEL_PROJECT_ID
    mockFrom.mockReturnValue(makeInsertBuilder())

    const result = await findPreviewDeployment('deadbeef')

    expect(result.status).toBe('not_found')
    const row = mockInsert.mock.calls[0][0]
    expect(row.meta.missing).toBe('VERCEL_PROJECT_ID')
    expect(row.meta.commit_sha).toBe('deadbeef')
  })

  it('includes teamId in query params when VERCEL_TEAM_ID is set', async () => {
    process.env.VERCEL_TEAM_ID = 'team_abc'
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
    })

    await findPreviewDeployment('abc1234')

    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('teamId=team_abc')
  })

  it('returns not_found when Vercel API returns non-200', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 })

    const result = await findPreviewDeployment('abc1234')

    expect(result.status).toBe('not_found')
  })

  it('returns error status when Vercel reports ERROR readyState', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deployments: [makeVercelDeployment('ERROR')] }),
    })

    const result = await findPreviewDeployment('abc1234')

    expect(result.status).toBe('error')
  })
})

// ── GET /api/cron/deploy-gate-runner — auth ───────────────────────────────────

describe('GET /api/cron/deploy-gate-runner — auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest({ Authorization: '' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    const res = await GET(makeRequest({ Authorization: 'Bearer wrong-secret' }))
    expect(res.status).toBe(401)
  })

  it('does not query agent_events on unauthorized request', async () => {
    await GET(makeRequest({ Authorization: 'Bearer wrong' }))
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── GET /api/cron/deploy-gate-runner — no pending triggers ────────────────────

describe('GET /api/cron/deploy-gate-runner — no pending triggers', () => {
  it('returns ok with processed=0 when no trigger rows exist', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([]))

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(0)
    expect(body.reason).toBe('no-pending-triggers')
  })

  it('queries only status=success triggers (skips tests_passed=false / status=error rows)', async () => {
    const sb = makeSelectBuilder([])
    mockFrom.mockReturnValue(sb)

    await GET(makeRequest())

    expect(sb.eq).toHaveBeenCalledWith('task_type', 'deploy_gate_triggered')
    expect(sb.eq).toHaveBeenCalledWith('status', 'success')
  })
})

// ── GET /api/cron/deploy-gate-runner — happy path ────────────────────────────

describe('GET /api/cron/deploy-gate-runner — happy path', () => {
  it('picks up a pending trigger, writes processing row, then preview_ready row', async () => {
    const trigger = makeTriggerRow('f3f43eb', 3)

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger])) // triggers query
      .mockReturnValueOnce(makeSelectBuilder([])) // terminal rows
      .mockReturnValueOnce(makeSelectBuilder([])) // processing markers
      .mockReturnValueOnce(makeSelectBuilder([])) // smoke-passed rows
      .mockReturnValue(makeInsertBuilder()) // subsequent inserts

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      }
      if (url.includes('api.github.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ files: [] }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ ok: true, commit: null, timestamp: new Date().toISOString() }),
      })
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(1)
    expect(body.results[0]).toContain('ready')

    // processing + preview_ready + smoke_preview + schema_check = 4 inserts
    expect(mockInsert).toHaveBeenCalledTimes(4)

    const processingRow = mockInsert.mock.calls[0][0]
    expect(processingRow.task_type).toBe('deploy_gate_processing')
    expect(processingRow.meta.commit_sha).toBe('f3f43eb')
    expect(processingRow.meta.trigger_event_id).toBe(trigger.id)

    const outcomeRow = mockInsert.mock.calls[1][0]
    expect(outcomeRow.task_type).toBe('deploy_gate_preview_ready')
    expect(outcomeRow.status).toBe('success')
    expect(outcomeRow.meta.commit_sha).toBe('f3f43eb')
    expect(outcomeRow.meta.preview_url).toBe('https://preview-abc.vercel.app')
    expect(outcomeRow.meta.trigger_event_id).toBe(trigger.id)

    const smokeRow = mockInsert.mock.calls[2][0]
    expect(smokeRow.task_type).toBe('deploy_gate_smoke_preview')
    expect(smokeRow.status).toBe('success')
    expect(smokeRow.meta.commit_sha).toBe('f3f43eb')
    expect(smokeRow.meta.preview_url).toBe('https://preview-abc.vercel.app')
    expect(smokeRow.meta.status_code).toBe(200)

    const schemaRow = mockInsert.mock.calls[3][0]
    expect(schemaRow.task_type).toBe('deploy_gate_schema_check')
    expect(schemaRow.status).toBe('success')
    expect(schemaRow.meta.commit_sha).toBe('f3f43eb')
    expect(schemaRow.meta.has_migrations).toBe(false)
    expect(schemaRow.meta.migration_files).toEqual([])
  })

  it('leaves building triggers in place (no outcome row written)', async () => {
    const trigger = makeTriggerRow('building1', 3)

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([])) // smoke-passed rows
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deployments: [makeVercelDeployment('BUILDING')] }),
    })

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.results[0]).toContain('building')

    // only the processing marker is written — no outcome row
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockInsert.mock.calls[0][0].task_type).toBe('deploy_gate_processing')
  })
})

// ── GET /api/cron/deploy-gate-runner — skips terminal triggers ────────────────

describe('GET /api/cron/deploy-gate-runner — skips terminal triggers', () => {
  it('skips trigger that already has a deploy_gate_schema_check row', async () => {
    const trigger = makeTriggerRow('abc1234', 3)
    const terminalRow = { id: 'x', meta: { commit_sha: 'abc1234' } }

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([terminalRow])) // terminal outcome exists
      .mockReturnValue(makeSelectBuilder([]))

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.processed).toBe(0)
    expect(body.reason).toBe('all-in-progress-or-terminal')
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('skips trigger being handled by another tick (processing marker present)', async () => {
    const trigger = makeTriggerRow('inprog1', 3)
    const processingRow = { meta: { commit_sha: 'inprog1' } }

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([])) // no terminal rows
      .mockReturnValueOnce(makeSelectBuilder([processingRow])) // processing marker exists
      .mockReturnValue(makeSelectBuilder([]))

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.processed).toBe(0)
    expect(body.reason).toBe('all-in-progress-or-terminal')
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

// ── GET /api/cron/deploy-gate-runner — timeout ───────────────────────────────

describe('GET /api/cron/deploy-gate-runner — timeout', () => {
  it('writes deploy_gate_failed with reason=preview_timeout when trigger is > 10 minutes old', async () => {
    const trigger = makeTriggerRow('old1234', 12) // 12 minutes ago

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([])) // smoke-passed rows
      .mockReturnValue(makeInsertBuilder())

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.results[0]).toContain('timeout')

    // processing marker + timeout failure = 2 inserts; Vercel was never polled
    expect(mockInsert).toHaveBeenCalledTimes(2)
    const vercelCalls = mockFetch.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('api.vercel.com')
    )
    expect(vercelCalls).toHaveLength(0)

    const timeoutRow = mockInsert.mock.calls[1][0]
    expect(timeoutRow.task_type).toBe('deploy_gate_failed')
    expect(timeoutRow.status).toBe('error')
    expect(timeoutRow.meta.reason).toBe('preview_timeout')
    expect(timeoutRow.meta.commit_sha).toBe('old1234')
  })

  it('does not write timeout for trigger exactly at the 10-minute boundary (still polling)', async () => {
    const trigger = makeTriggerRow('edge1', 9) // 9 minutes ago — under timeout

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([])) // smoke-passed rows
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deployments: [makeVercelDeployment('BUILDING')] }),
    })

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.results[0]).toContain('building')
    // Only processing marker — no timeout row
    expect(mockInsert).toHaveBeenCalledTimes(1)
  })
})

// ── GET /api/cron/deploy-gate-runner — concurrency cap ───────────────────────

describe('GET /api/cron/deploy-gate-runner — concurrency cap', () => {
  it('processes up to 5 triggers per tick without duplicating, leaving the 6th for next tick', async () => {
    const shas = ['sha1', 'sha2', 'sha3', 'sha4', 'sha5', 'sha6']
    const triggers = shas.map((sha) => makeTriggerRow(sha, 3))

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder(triggers)) // all 6 returned by DB
      .mockReturnValueOnce(makeSelectBuilder([])) // no terminal rows
      .mockReturnValueOnce(makeSelectBuilder([])) // no processing markers
      .mockReturnValueOnce(makeSelectBuilder([])) // smoke-passed rows
      .mockReturnValue(makeInsertBuilder()) // all inserts

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      }
      if (url.includes('api.github.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ files: [] }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      })
    })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.processed).toBe(5) // capped at MAX_PER_TICK=5
    // 4 inserts per trigger (processing + preview_ready + smoke_preview + schema_check) × 5 = 20
    expect(mockInsert).toHaveBeenCalledTimes(20)

    // Each SHA processed exactly once — no duplicates
    const processingShas = mockInsert.mock.calls
      .filter((c) => c[0].task_type === 'deploy_gate_processing')
      .map((c) => c[0].meta.commit_sha as string)
    expect(processingShas).toHaveLength(5)
    expect(new Set(processingShas).size).toBe(5) // all unique

    // sha6 was NOT processed (it was the 6th)
    expect(processingShas).not.toContain('sha6')
  })

  it('returns all-in-progress-or-terminal when all pending shas have processing markers', async () => {
    const shas = ['sha1', 'sha2']
    const triggers = shas.map((sha) => makeTriggerRow(sha, 3))
    const processingMarkers = shas.map((sha) => ({ meta: { commit_sha: sha } }))

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder(triggers))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder(processingMarkers))
      .mockReturnValue(makeSelectBuilder([]))

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.processed).toBe(0)
    expect(body.reason).toBe('all-in-progress-or-terminal')
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

// ── runSmokeCheck ─────────────────────────────────────────────────────────────

describe('runSmokeCheck', () => {
  afterEach(() => {
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  })

  it('returns pass when health endpoint returns 200 with ok:true', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ ok: true, commit: 'abc', timestamp: '2026-01-01T00:00:00.000Z' }),
    })

    const result = await runSmokeCheck('https://preview-abc.vercel.app')

    expect(result.status).toBe('pass')
    expect(result.status_code).toBe(200)
    expect(result.response_ms).toBeGreaterThanOrEqual(0)
    expect(result.body_excerpt).toContain('"ok":true')
  })

  it('returns fail when health endpoint returns non-200', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) })

    const result = await runSmokeCheck('https://preview-abc.vercel.app')

    expect(result.status).toBe('fail')
    expect(result.status_code).toBe(503)
  })

  it('returns fail when body.ok is false', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: false }),
    })

    const result = await runSmokeCheck('https://preview-abc.vercel.app')

    expect(result.status).toBe('fail')
    expect(result.status_code).toBe(200)
  })

  it('calls the correct URL (preview_url + /api/health)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    })

    await runSmokeCheck('https://preview-abc.vercel.app')

    expect(mockFetch.mock.calls[0][0]).toBe('https://preview-abc.vercel.app/api/health')
  })

  it('sends x-vercel-protection-bypass header when VERCEL_AUTOMATION_BYPASS_SECRET is set', async () => {
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'bypass-secret-abc'
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    })

    await runSmokeCheck('https://preview-abc.vercel.app')

    const call = mockFetch.mock.calls[0]
    expect(call[1].headers['x-vercel-protection-bypass']).toBe('bypass-secret-abc')
  })

  it('does not send x-vercel-protection-bypass header when secret is not set', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    })

    await runSmokeCheck('https://preview-abc.vercel.app')

    const call = mockFetch.mock.calls[0]
    expect(call[1].headers['x-vercel-protection-bypass']).toBeUndefined()
  })

  it('returns fail with error when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('network failure'))

    const result = await runSmokeCheck('https://preview-abc.vercel.app')

    expect(result.status).toBe('fail')
    expect(result.error).toBe('network failure')
    expect(result.status_code).toBe(0)
  })
})

// ── GET /api/cron/deploy-gate-runner — smoke check integration ────────────────

describe('GET /api/cron/deploy-gate-runner — smoke check', () => {
  it('writes deploy_gate_smoke_preview:success after preview_ready when smoke passes', async () => {
    const trigger = makeTriggerRow('f3f43eb', 3)

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([])) // smoke-passed rows
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      }
      if (url.includes('api.github.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ files: [] }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ ok: true, commit: null, timestamp: new Date().toISOString() }),
      })
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)

    // processing + preview_ready + smoke_preview + schema_check = 4 inserts
    expect(mockInsert).toHaveBeenCalledTimes(4)

    const smokeRow = mockInsert.mock.calls[2][0]
    expect(smokeRow.task_type).toBe('deploy_gate_smoke_preview')
    expect(smokeRow.status).toBe('success')
    expect(smokeRow.meta.commit_sha).toBe('f3f43eb')
    expect(smokeRow.meta.preview_url).toBe('https://preview-abc.vercel.app')
    expect(smokeRow.meta.status_code).toBe(200)

    const schemaRow = mockInsert.mock.calls[3][0]
    expect(schemaRow.task_type).toBe('deploy_gate_schema_check')
    expect(schemaRow.status).toBe('success')
    expect(schemaRow.meta.has_migrations).toBe(false)
  })

  it('writes deploy_gate_smoke_preview:error when smoke returns non-200', async () => {
    const trigger = makeTriggerRow('f3f43eb', 3)

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([])) // smoke-passed rows
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      }
      return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })
    })

    await GET(makeRequest())

    expect(mockInsert).toHaveBeenCalledTimes(3)

    const smokeRow = mockInsert.mock.calls[2][0]
    expect(smokeRow.task_type).toBe('deploy_gate_smoke_preview')
    expect(smokeRow.status).toBe('error')
    expect(smokeRow.meta.status_code).toBe(503)
  })

  it('does not block preview_ready outcome when smoke fetch throws', async () => {
    const trigger = makeTriggerRow('f3f43eb', 3)

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([])) // smoke-passed rows
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      }
      return Promise.reject(new Error('network failure'))
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results[0]).toContain('ready')

    // preview_ready still written — smoke fetch error swallowed
    const previewReadyRow = mockInsert.mock.calls[1][0]
    expect(previewReadyRow.task_type).toBe('deploy_gate_preview_ready')
  })
})

// ── detectMigrations ──────────────────────────────────────────────────────────

describe('detectMigrations', () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN
  })

  it('detects a single migration file', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          files: [
            { filename: 'supabase/migrations/0001_initial.sql' },
            { filename: 'app/components/Button.tsx' },
          ],
        }),
    })

    const result = await detectMigrations('abc1234', 'harness/task-test')

    expect(result.has_migrations).toBe(true)
    expect(result.migration_files).toEqual(['supabase/migrations/0001_initial.sql'])
    expect(result.error).toBeUndefined()
  })

  it('filters correctly — only supabase/migrations/ files returned', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          files: [
            { filename: 'supabase/migrations/0002_add_index.sql' },
            { filename: 'supabase/migrations/0003_add_column.sql' },
            { filename: 'app/page.tsx' },
            { filename: 'lib/utils.ts' },
            { filename: 'package.json' },
          ],
        }),
    })

    const result = await detectMigrations('abc1234', 'harness/task-test')

    expect(result.has_migrations).toBe(true)
    expect(result.migration_files).toHaveLength(2)
    expect(result.migration_files).toContain('supabase/migrations/0002_add_index.sql')
    expect(result.migration_files).toContain('supabase/migrations/0003_add_column.sql')
  })

  it('returns has_migrations=false when no migration files in diff', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ files: [{ filename: 'app/page.tsx' }] }),
    })

    const result = await detectMigrations('abc1234', 'harness/task-test')

    expect(result.has_migrations).toBe(false)
    expect(result.migration_files).toEqual([])
    expect(result.error).toBeUndefined()
  })

  it('returns error=config when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN

    const result = await detectMigrations('abc1234', 'harness/task-test')

    expect(result.error).toBe('config')
    expect(result.has_migrations).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns error=api_error on 403 from GitHub', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) })

    const result = await detectMigrations('abc1234', 'harness/task-test')

    expect(result.error).toBe('api_error')
    expect(result.has_migrations).toBe(false)
  })

  it('returns error=api_error on 404 from GitHub', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) })

    const result = await detectMigrations('abc1234', 'harness/task-test')

    expect(result.error).toBe('api_error')
    expect(result.has_migrations).toBe(false)
  })

  it('calls the correct GitHub compare URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ files: [] }),
    })

    await detectMigrations('deadbeef', 'harness/task-test')

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/loeppkyc/lepios/compare/main...deadbeef'
    )
  })
})

// ── GET /api/cron/deploy-gate-runner — schema check integration ───────────────

describe('GET /api/cron/deploy-gate-runner — schema check', () => {
  function makeFullFetchMock(githubFiles: Array<{ filename: string }> = []) {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      }
      if (url.includes('api.github.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ files: githubFiles }),
        })
      }
      // smoke health check
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      })
    })
  }

  it('writes schema_check:success when no migration files detected', async () => {
    const trigger = makeTriggerRow('f3f43eb', 3)
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())
    makeFullFetchMock([])

    await GET(makeRequest())

    expect(mockInsert).toHaveBeenCalledTimes(4)
    const schemaRow = mockInsert.mock.calls[3][0]
    expect(schemaRow.task_type).toBe('deploy_gate_schema_check')
    expect(schemaRow.status).toBe('success')
    expect(schemaRow.meta.has_migrations).toBe(false)
    expect(schemaRow.meta.migration_files).toEqual([])
  })

  it('writes schema_check:warning (not error) when migration files detected', async () => {
    const trigger = makeTriggerRow('f3f43eb', 3)
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())
    makeFullFetchMock([{ filename: 'supabase/migrations/0010_add_table.sql' }])

    await GET(makeRequest())

    // 5th insert: runMigrationGate fires after schema-migrations; fetchMigrationSQL fails
    // because the GitHub mock returns { files: [...] } (compare format) for the contents API
    // URL, so content is undefined → error='api_error' → deploy_gate_failed written
    expect(mockInsert).toHaveBeenCalledTimes(5)
    const schemaRow = mockInsert.mock.calls[3][0]
    expect(schemaRow.task_type).toBe('deploy_gate_schema_check')
    expect(schemaRow.status).toBe('warning')
    expect(schemaRow.meta.has_migrations).toBe(true)
    expect(schemaRow.meta.migration_files).toEqual(['supabase/migrations/0010_add_table.sql'])
    const gateRow = mockInsert.mock.calls[4][0]
    expect(gateRow.task_type).toBe('deploy_gate_failed')
    expect(gateRow.meta.reason).toBe('migration_fetch')
  })

  it('writes schema_check:error and halts on config error (missing GITHUB_TOKEN)', async () => {
    delete process.env.GITHUB_TOKEN
    const trigger = makeTriggerRow('f3f43eb', 3)
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())
    makeFullFetchMock([])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(mockInsert).toHaveBeenCalledTimes(4)
    const schemaRow = mockInsert.mock.calls[3][0]
    expect(schemaRow.task_type).toBe('deploy_gate_schema_check')
    expect(schemaRow.status).toBe('error')
    expect(schemaRow.meta.error).toBe('config')

    // result string signals halt
    expect(body.results.some((r: string) => r.includes('schema-error'))).toBe(true)
  })

  it('advances smoke-passed trigger to schema_check in same tick', async () => {
    const trigger = makeTriggerRow('smokeonly', 3)
    const smokePassedRow = { meta: { commit_sha: 'smokeonly' } }

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger])) // triggers
      .mockReturnValueOnce(makeSelectBuilder([])) // terminal (no schema_check yet)
      .mockReturnValueOnce(makeSelectBuilder([])) // processing markers
      .mockReturnValueOnce(makeSelectBuilder([smokePassedRow])) // smoke-passed rows
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ files: [] }),
    })

    await GET(makeRequest())

    // processing + schema_check = 2 inserts (no Vercel poll, no smoke re-run)
    expect(mockInsert).toHaveBeenCalledTimes(2)
    const schemaRow = mockInsert.mock.calls[1][0]
    expect(schemaRow.task_type).toBe('deploy_gate_schema_check')
    expect(schemaRow.meta.commit_sha).toBe('smokeonly')
  })
})

// ── mergeToMain ───────────────────────────────────────────────────────────────

describe('mergeToMain', () => {
  it('returns ok=true with merge_sha on 201 response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ sha: 'abc1234' }),
    })

    const result = await mergeToMain('harness/task-abc', 'task-uuid', 'commitabc')

    expect(result.ok).toBe(true)
    expect(result.merge_sha).toBe('abc1234')
  })

  it('returns ok=true on 204 (already up to date)', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204, json: () => Promise.resolve({}) })

    const result = await mergeToMain('harness/task-abc', 'task-uuid', 'commitabc')

    expect(result.ok).toBe(true)
    expect(result.merge_sha).toBeUndefined()
  })

  it('returns ok=false with http_409 on merge conflict', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({}) })

    const result = await mergeToMain('harness/task-abc', 'task-uuid', 'commitabc')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('http_409')
  })

  it('returns ok=false with error=config when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN

    const result = await mergeToMain('harness/task-abc', 'task-uuid', 'commitabc')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('config')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns ok=false with error=api_error on fetch throw', async () => {
    mockFetch.mockRejectedValue(new Error('network'))

    const result = await mergeToMain('harness/task-abc', 'task-uuid', 'commitabc')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('api_error')
  })

  it('calls the correct GitHub merges URL with POST', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ sha: 'newsha' }),
    })

    await mergeToMain('harness/task-abc', 'task-uuid', 'commitabc')

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/loeppkyc/lepios/merges')
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body as string)
    expect(body.base).toBe('main')
    expect(body.head).toBe('harness/task-abc')
    expect(body.commit_message).toContain('task-uuid')
    expect(body.commit_message).toContain('commitabc')
  })
})

// ── deleteBranch ──────────────────────────────────────────────────────────────

describe('deleteBranch', () => {
  it('returns true on 204', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 })

    const result = await deleteBranch('harness/task-abc')

    expect(result).toBe(true)
  })

  it('returns false on non-204 status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 })

    const result = await deleteBranch('harness/task-abc')

    expect(result).toBe(false)
  })

  it('returns false when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN

    const result = await deleteBranch('harness/task-abc')

    expect(result).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('calls the correct DELETE URL', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 })

    await deleteBranch('harness/task-abc')

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/loeppkyc/lepios/git/refs/heads/harness/task-abc')
    expect(opts.method).toBe('DELETE')
  })
})

// ── GET /api/cron/deploy-gate-runner — auto-promote (Chunk E) ─────────────────

describe('GET /api/cron/deploy-gate-runner — auto-promote kill switch', () => {
  it('pushes promotion-skipped to results when DEPLOY_GATE_AUTO_PROMOTE=0, no extra DB insert', async () => {
    // DEPLOY_GATE_AUTO_PROMOTE=0 already set in beforeEach
    const trigger = makeTriggerRow('f3f43eb', 3)
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      if (url.includes('api.github.com') && !url.includes('/merges'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: [] }) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
    })

    const res = await GET(makeRequest())
    const body = await res.json()

    // 4 inserts only (no deploy_gate_promoted row)
    expect(mockInsert).toHaveBeenCalledTimes(4)
    // results includes the promotion-skipped signal
    expect(body.results.some((r: string) => r.includes('promotion-skipped'))).toBe(true)
  })
})

describe('GET /api/cron/deploy-gate-runner — auto-promote enabled', () => {
  beforeEach(() => {
    process.env.DEPLOY_GATE_AUTO_PROMOTE = '1'
  })

  it('calls mergeToMain and writes deploy_gate_promoted on successful merge', async () => {
    const trigger = makeTriggerRow('abc1234', 3)
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      if (url.includes('/merges'))
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ sha: 'mergesha123' }),
        })
      if (url.includes('api.github.com/repos') && url.includes('git/refs'))
        return Promise.resolve({ ok: true, status: 204 })
      if (url.includes('api.github.com'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: [] }) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
    })

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)

    // processing + preview_ready + smoke + schema + promoted + smoke_pending = 6 inserts
    expect(mockInsert).toHaveBeenCalledTimes(6)
    const promotedRow = mockInsert.mock.calls[4][0]
    expect(promotedRow.task_type).toBe('deploy_gate_promoted')
    expect(promotedRow.status).toBe('success')
    expect(promotedRow.meta.commit_sha).toBe('abc1234')
    expect(promotedRow.meta.merge_sha).toBe('mergesha123')

    const smokePendingRow = mockInsert.mock.calls[5][0]
    expect(smokePendingRow.action).toBe('production_smoke_pending')
    expect(smokePendingRow.meta.merge_sha).toBe('mergesha123')

    expect(body.results.some((r: string) => r.includes(':promoted'))).toBe(true)
  })

  it('writes deploy_gate_failed when merge returns non-201', async () => {
    const trigger = makeTriggerRow('abc1234', 3)
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      if (url.includes('/merges'))
        return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({}) })
      if (url.includes('api.github.com'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: [] }) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
    })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(mockInsert).toHaveBeenCalledTimes(5)
    const failRow = mockInsert.mock.calls[4][0]
    expect(failRow.task_type).toBe('deploy_gate_failed')
    expect(failRow.meta.reason).toBe('merge_failed')
    expect(failRow.meta.error).toBe('http_409')

    expect(body.results.some((r: string) => r.includes(':merge-failed'))).toBe(true)
  })

  it('does not call merge when schema-migrations detected (sends migration gate instead)', async () => {
    const trigger = makeTriggerRow('abc1234', 3)
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      if (url.includes('api.github.com'))
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ files: [{ filename: 'supabase/migrations/0017_test.sql' }] }),
        })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
    })

    await GET(makeRequest())

    // No merge call — schema has migrations, migration gate fires instead
    const mergeCalls = mockFetch.mock.calls.filter(([url]: [string]) => url.includes('/merges'))
    expect(mergeCalls).toHaveLength(0)

    // 5 inserts: smoke×2, promoted×0, schema_check, deploy_gate_failed (migration_fetch)
    expect(mockInsert).toHaveBeenCalledTimes(5)
    const schemaRow = mockInsert.mock.calls[3][0]
    expect(schemaRow.task_type).toBe('deploy_gate_schema_check')
    expect(schemaRow.status).toBe('warning')
    const gateRow = mockInsert.mock.calls[4][0]
    expect(gateRow.task_type).toBe('deploy_gate_failed')
    expect(gateRow.meta.reason).toBe('migration_fetch')
  })
})

// ── rollbackDeployment ────────────────────────────────────────────────────────

describe('rollbackDeployment', () => {
  const MERGE_SHA = 'mergesha1'
  const PARENT_SHA = 'parentsha1'
  const TREE_SHA = 'treesha1'
  const REVERT_SHA = 'revertsha1'

  function makeRollbackFetch() {
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      // GET merge commit
      if (url.includes(`/git/commits/${MERGE_SHA}`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ parents: [{ sha: PARENT_SHA }] }),
        })
      }
      // GET parent commit
      if (url.includes(`/git/commits/${PARENT_SHA}`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ tree: { sha: TREE_SHA } }),
        })
      }
      // GET main ref
      if (
        url.includes('/git/refs/heads/main') &&
        (!opts || !opts.method || opts.method === 'GET')
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ object: { sha: MERGE_SHA } }),
        })
      }
      // POST new commit
      if (url.includes('/git/commits') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ sha: REVERT_SHA }),
        })
      }
      // PATCH main ref
      if (url.includes('/git/refs/heads/main') && opts?.method === 'PATCH') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
    })
  }

  it('returns ok=true with revert_sha on success', async () => {
    makeRollbackFetch()
    const result = await rollbackDeployment(MERGE_SHA, 'task-uuid-1')
    expect(result.ok).toBe(true)
    expect(result.revert_sha).toBe(REVERT_SHA)
  })

  it('returns ok=false with error=config when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN
    const result = await rollbackDeployment(MERGE_SHA, 'task-uuid-1')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('config')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns ok=false with error=main_moved_on when current HEAD differs from merge_sha', async () => {
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes(`/git/commits/${MERGE_SHA}`))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ parents: [{ sha: PARENT_SHA }] }),
        })
      if (url.includes(`/git/commits/${PARENT_SHA}`))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tree: { sha: TREE_SHA } }),
        })
      if (url.includes('/git/refs/heads/main') && (!opts?.method || opts.method === 'GET'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ object: { sha: 'differentsha' } }),
        })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    const result = await rollbackDeployment(MERGE_SHA, 'task-uuid-1')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('main_moved_on')
  })

  it('returns ok=false with http error when GET merge commit fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

    const result = await rollbackDeployment(MERGE_SHA, 'task-uuid-1')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('http_404')
  })

  it('returns ok=false with api_error when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))

    const result = await rollbackDeployment(MERGE_SHA, 'task-uuid-1')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('api_error')
  })

  it('POSTs revert commit with correct tree and parent', async () => {
    makeRollbackFetch()
    await rollbackDeployment(MERGE_SHA, 'task-uuid-1')

    const postCall = mockFetch.mock.calls.find(
      ([url, opts]: [string, RequestInit]) =>
        url.includes('/git/commits') && opts?.method === 'POST'
    )
    expect(postCall).toBeDefined()
    const body = JSON.parse(postCall![1].body as string)
    expect(body.tree).toBe(TREE_SHA)
    expect(body.parents).toEqual([MERGE_SHA])
    expect(body.message).toContain('task-uuid-1')
  })

  it('PATCHes main ref to revert commit SHA', async () => {
    makeRollbackFetch()
    await rollbackDeployment(MERGE_SHA, 'task-uuid-1')

    const patchCall = mockFetch.mock.calls.find(
      ([url, opts]: [string, RequestInit]) =>
        url.includes('/git/refs/heads/main') && opts?.method === 'PATCH'
    )
    expect(patchCall).toBeDefined()
    const body = JSON.parse(patchCall![1].body as string)
    expect(body.sha).toBe(REVERT_SHA)
  })
})

// ── sendPromotionNotification ─────────────────────────────────────────────────

describe('sendPromotionNotification', () => {
  const params = {
    task_id: 'task-uuid-2',
    branch: 'harness/task-task-uuid-2',
    merge_sha: 'abcdef1234567890',
    commit_sha: 'feedbeef1234',
  }

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-tg-token'
    process.env.TELEGRAM_CHAT_ID = '111222'
  })

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  })

  it('returns ok=false error=config when TELEGRAM_BOT_TOKEN is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    const result = await sendPromotionNotification(params)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('config')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns ok=false error=config when TELEGRAM_CHAT_ID is missing', async () => {
    delete process.env.TELEGRAM_CHAT_ID
    const result = await sendPromotionNotification(params)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('config')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns ok=true with message_id on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 9999 } }),
    })

    const result = await sendPromotionNotification(params)
    expect(result.ok).toBe(true)
    expect(result.message_id).toBe(9999)
  })

  it('sends rollback button with correct dg:rb: callback_data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
    })

    await sendPromotionNotification(params)

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/sendMessage')
    const body = JSON.parse(opts.body as string)
    const buttons = body.reply_markup.inline_keyboard[0]
    expect(buttons).toHaveLength(1)
    expect(buttons[0].callback_data).toBe(`dg:rb:${params.merge_sha.slice(0, 8)}`)
    expect(buttons[0].text).toBe('👎 Rollback')
  })

  it('returns ok=false when Telegram API returns non-200', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })

    const result = await sendPromotionNotification(params)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('telegram_429')
  })

  it('returns ok=false with error message on fetch throw', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))
    const result = await sendPromotionNotification(params)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('timeout')
  })
})

// ── GET /api/cron/deploy-gate-runner — notification sent (Chunk F) ─────────────

describe('GET /api/cron/deploy-gate-runner — promotion notification', () => {
  beforeEach(() => {
    process.env.DEPLOY_GATE_AUTO_PROMOTE = '1'
    process.env.TELEGRAM_BOT_TOKEN = 'test-tg-token'
    process.env.TELEGRAM_CHAT_ID = '111222'
  })

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  })

  it('writes deploy_gate_notification_sent row when Telegram succeeds', async () => {
    const trigger = makeTriggerRow('notifsha', 3)
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('api.vercel.com'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      if (url.includes('/merges'))
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ sha: 'mergenotif1' }),
        })
      if (
        url.includes('api.github.com/repos') &&
        url.includes('git/refs') &&
        opts?.method === 'DELETE'
      )
        return Promise.resolve({ ok: true, status: 204 })
      if (url.includes('api.github.com'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: [] }) })
      if (url.includes('telegram.org') && url.includes('sendMessage'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: { message_id: 8888 } }),
        })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
    })

    await GET(makeRequest())

    // processing + preview_ready + smoke + schema + promoted + notification_sent + smoke_pending = 7
    expect(mockInsert).toHaveBeenCalledTimes(7)
    const notifRow = mockInsert.mock.calls[5][0]
    expect(notifRow.task_type).toBe('deploy_gate_notification_sent')
    expect(notifRow.status).toBe('success')
    expect(notifRow.meta.message_id).toBe(8888)
    expect(notifRow.meta.merge_sha).toBe('mergenotif1')
  })

  it('promoted row includes task_id in meta', async () => {
    const trigger = makeTriggerRow('taskidsha', 3)
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('api.vercel.com'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      if (url.includes('/merges'))
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ sha: 'mergetaskid1' }),
        })
      if (
        url.includes('api.github.com/repos') &&
        url.includes('git/refs') &&
        opts?.method === 'DELETE'
      )
        return Promise.resolve({ ok: true, status: 204 })
      if (url.includes('api.github.com'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: [] }) })
      if (url.includes('telegram.org'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
        })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
    })

    await GET(makeRequest())

    const promotedRow = mockInsert.mock.calls[4][0]
    expect(promotedRow.task_type).toBe('deploy_gate_promoted')
    expect(promotedRow.meta.task_id).toBe('00000000-0000-0000-0000-000000000001')
  })

  it('does not write notification_sent when Telegram is unconfigured (no insert count change)', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN

    const trigger = makeTriggerRow('nonotif', 3)
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([])) // production smoke pending — none
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      if (url.includes('/merges'))
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ sha: 'mergenonotif' }),
        })
      if (url.includes('api.github.com'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: [] }) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
    })

    await GET(makeRequest())

    // 6 inserts — no notification_sent (Telegram not configured) but smoke_pending after delete
    expect(mockInsert).toHaveBeenCalledTimes(6)
    const taskTypes = mockInsert.mock.calls.map(
      (c: unknown[][]) => (c[0] as { task_type: string }).task_type
    )
    expect(taskTypes).not.toContain('deploy_gate_notification_sent')
  })
})

// ── fetchMigrationSQL ─────────────────────────────────────────────────────────

describe('fetchMigrationSQL', () => {
  const COMMIT_SHA = 'abc1234deadbeef'

  afterEach(() => {
    delete process.env.GITHUB_TOKEN
  })

  it('returns error=config when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN
    const result = await fetchMigrationSQL(COMMIT_SHA, ['supabase/migrations/0001.sql'])
    expect(result.error).toBe('config')
    expect(result.files).toHaveLength(0)
  })

  it('returns error=api_error when GitHub returns non-ok status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 })
    const result = await fetchMigrationSQL(COMMIT_SHA, ['supabase/migrations/0001.sql'])
    expect(result.error).toBe('api_error')
  })

  it('returns error=api_error when response JSON has no content field', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'file.sql' }),
    })
    const result = await fetchMigrationSQL(COMMIT_SHA, ['supabase/migrations/0001.sql'])
    expect(result.error).toBe('api_error')
  })

  it('returns error=api_error when encoding is not base64', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: 'SELECT 1;', encoding: 'utf-8' }),
    })
    const result = await fetchMigrationSQL(COMMIT_SHA, ['supabase/migrations/0001.sql'])
    expect(result.error).toBe('api_error')
  })

  it('decodes base64 content and returns file on success', async () => {
    const sql = 'CREATE TABLE foo (id serial);'
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: Buffer.from(sql).toString('base64'),
          encoding: 'base64',
        }),
    })
    const result = await fetchMigrationSQL(COMMIT_SHA, ['supabase/migrations/0001.sql'])
    expect(result.error).toBeUndefined()
    expect(result.files).toHaveLength(1)
    expect(result.files[0].content).toBe(sql)
    expect(result.files[0].filename).toBe('supabase/migrations/0001.sql')
    expect(result.files[0].size_bytes).toBe(sql.length)
    expect(result.total_size_bytes).toBe(sql.length)
  })

  it('fetches the correct contents URL with ref param', async () => {
    const sql = 'SELECT 1;'
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ content: Buffer.from(sql).toString('base64'), encoding: 'base64' }),
    })
    await fetchMigrationSQL(COMMIT_SHA, ['supabase/migrations/0010.sql'])
    expect(mockFetch.mock.calls[0][0]).toContain(
      `contents/supabase/migrations/0010.sql?ref=${COMMIT_SHA}`
    )
  })

  it('accumulates total_size_bytes across multiple files', async () => {
    const sql1 = 'CREATE TABLE a (id serial);'
    const sql2 = 'CREATE TABLE b (id serial);'
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ content: Buffer.from(sql1).toString('base64'), encoding: 'base64' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ content: Buffer.from(sql2).toString('base64'), encoding: 'base64' }),
      })
    const result = await fetchMigrationSQL(COMMIT_SHA, [
      'supabase/migrations/0001.sql',
      'supabase/migrations/0002.sql',
    ])
    expect(result.files).toHaveLength(2)
    expect(result.total_size_bytes).toBe(sql1.length + sql2.length)
  })
})

// ── sendMigrationGateMessage ──────────────────────────────────────────────────

describe('sendMigrationGateMessage', () => {
  const TASK_ID = '885ff1e3-baed-4512-8e7a-8335995ea057'
  const BRANCH = 'harness/task-migration-test'
  const COMMIT_SHA = 'f3f43eb1234567890abcdef1234567890abcdef'
  const SQL_FILE = {
    filename: 'supabase/migrations/0010.sql',
    content: 'CREATE TABLE t1;',
    size_bytes: 16,
  }

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
    process.env.TELEGRAM_CHAT_ID = '111222'
  })

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  })

  it('returns error=config when TELEGRAM_BOT_TOKEN is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    const result = await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [SQL_FILE],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('config')
  })

  it('returns error=config when TELEGRAM_CHAT_ID is missing', async () => {
    delete process.env.TELEGRAM_CHAT_ID
    const result = await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [SQL_FILE],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('config')
  })

  it('returns ok=true with message_id on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 9001 } }),
    })
    const result = await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [SQL_FILE],
    })
    expect(result.ok).toBe(true)
    expect(result.message_id).toBe(9001)
    expect(result.truncated).toBeUndefined()
  })

  it('sends promote and abort inline keyboard buttons with correct callback_data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 9002 } }),
    })
    await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [SQL_FILE],
    })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    const shaPrefix = COMMIT_SHA.slice(0, 8)
    expect(body.reply_markup.inline_keyboard[0]).toEqual([
      { text: '👍 Promote', callback_data: `dg:promote:${shaPrefix}` },
      { text: '👎 Abort', callback_data: `dg:abort:${shaPrefix}` },
    ])
  })

  it('calls the Telegram sendMessage endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
    })
    await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [SQL_FILE],
    })
    expect(mockFetch.mock.calls[0][0]).toContain('/sendMessage')
  })

  it('returns ok=false when Telegram API returns non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })
    const result = await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [SQL_FILE],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('429')
  })

  it('sets truncated=true and stays within 3800 chars when message is too long', async () => {
    const longContent = 'x'.repeat(4000)
    const bigFile = {
      filename: 'supabase/migrations/long.sql',
      content: longContent,
      size_bytes: 4000,
    }
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 9003 } }),
    })
    const result = await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [bigFile],
    })
    expect(result.ok).toBe(true)
    expect(result.truncated).toBe(true)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.text.length).toBeLessThanOrEqual(3800)
  })
})

// ── insertSmokePendingEvent ───────────────────────────────────────────────────

describe('insertSmokePendingEvent', () => {
  it('inserts correct row fields into agent_events', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder())

    await insertSmokePendingEvent({
      merge_sha: 'abc123def456',
      commit_sha: 'def456abc123',
      branch: 'harness/task-test',
    })

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const row = mockInsert.mock.calls[0][0]
    expect(row.domain).toBe('orchestrator')
    expect(row.action).toBe('production_smoke_pending')
    expect(row.actor).toBe('deploy-gate')
    expect(row.status).toBe('success')
    expect(row.meta.merge_sha).toBe('abc123def456')
    expect(row.meta.commit_sha).toBe('def456abc123')
    expect(row.meta.branch).toBe('harness/task-test')
    expect(row.meta.merged_at).toBeDefined()
  })

  it('swallows errors without throwing', async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error('db connection failed')
    })

    await expect(
      insertSmokePendingEvent({ merge_sha: 'abc', commit_sha: 'def', branch: 'main' })
    ).resolves.toBeUndefined()
  })
})

// ── fetchMainCommits ──────────────────────────────────────────────────────────

describe('fetchMainCommits', () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN
  })

  it('returns empty array when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN
    const result = await fetchMainCommits()
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns empty array when GitHub API returns non-200', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 })
    const result = await fetchMainCommits()
    expect(result).toEqual([])
  })

  it('returns empty array when response body is not an array', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ commits: [] }) })
    const result = await fetchMainCommits()
    expect(result).toEqual([])
  })

  it('maps sha and commit message from GitHub response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { sha: 'abc123', commit: { message: 'BUMP: harness:smoke_test_framework=90' } },
          { sha: 'def456', commit: { message: 'feat: normal commit' } },
        ]),
    })

    const result = await fetchMainCommits()

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ sha: 'abc123', message: 'BUMP: harness:smoke_test_framework=90' })
    expect(result[1]).toEqual({ sha: 'def456', message: 'feat: normal commit' })
  })

  it('calls the correct GitHub commits URL with sha=main and per_page=20', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    await fetchMainCommits()
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('api.github.com/repos/loeppkyc/lepios/commits')
    expect(url).toContain('sha=main')
    expect(url).toContain('per_page=20')
  })
})

// ── GET /api/cron/deploy-gate-runner — production smoke runner ────────────────

describe('GET /api/cron/deploy-gate-runner — production smoke runner', () => {
  it('calls runRouteHealthSmoke with baseUrl and commitSha from pending event', async () => {
    const pendingRow = {
      id: 'evt-smoke1',
      meta: { merge_sha: 'abcdef121234', commit_sha: 'sha123', branch: 'main' },
      occurred_at: new Date().toISOString(),
    }

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([pendingRow])) // smoke pending query
      .mockReturnValueOnce(makeSelectBuilder([])) // smoke complete query
      .mockReturnValueOnce(makeInsertBuilder()) // smoke_complete insert
      .mockReturnValue(makeSelectBuilder([])) // triggers query + rest

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)

    expect(mockRunRouteHealthSmoke).toHaveBeenCalledOnce()
    expect(mockRunRouteHealthSmoke).toHaveBeenCalledWith('https://lepios-one.vercel.app', 'sha123')
    expect(mockRunCronRegistrationSmoke).toHaveBeenCalledOnce()
    expect(mockRunCronRegistrationSmoke).toHaveBeenCalledWith('https://lepios-one.vercel.app')
    expect(body.processed).toBe(1)
    expect(body.results[0]).toContain('smoke-passed')
  })

  it('does not re-run smoke for already-completed merge_sha (idempotent)', async () => {
    const pendingRow = {
      id: 'evt-smoke2',
      meta: { merge_sha: 'deadbeef1234', commit_sha: 'sha456', branch: 'main' },
      occurred_at: new Date().toISOString(),
    }
    const completeRow = { meta: { merge_sha: 'deadbeef1234' } }

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([pendingRow])) // smoke pending query
      .mockReturnValueOnce(makeSelectBuilder([completeRow])) // smoke complete — already done
      .mockReturnValue(makeSelectBuilder([])) // triggers query + rest

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)

    expect(mockRunRouteHealthSmoke).not.toHaveBeenCalled()
    expect(body.processed).toBe(0)
  })

  it('writes production_smoke_complete with status:error on smoke failure', async () => {
    const pendingRow = {
      id: 'evt-smoke3',
      meta: { merge_sha: 'failsha12345', commit_sha: 'sha789', branch: 'main' },
      occurred_at: new Date().toISOString(),
    }

    mockRunRouteHealthSmoke.mockResolvedValueOnce({
      passed: false,
      routes: [],
      failed_routes: ['/api/health'],
      total_ms: 100,
    })

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([pendingRow])) // smoke pending query
      .mockReturnValueOnce(makeSelectBuilder([])) // smoke complete query
      .mockReturnValueOnce(makeInsertBuilder()) // smoke_complete insert
      .mockReturnValue(makeSelectBuilder([])) // triggers query + rest

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)

    expect(mockRunRouteHealthSmoke).toHaveBeenCalledOnce()
    expect(body.results[0]).toContain('smoke-failed')

    const smokeCompleteRow = mockInsert.mock.calls[0][0]
    expect(smokeCompleteRow.action).toBe('production_smoke_complete')
    expect(smokeCompleteRow.status).toBe('error')
    expect(smokeCompleteRow.meta.merge_sha).toBe('failsha12345')
    expect(smokeCompleteRow.meta.l2_passed).toBe(false)
  })
})

// ── GET /api/cron/deploy-gate-runner — bump sweep ─────────────────────────────

describe('GET /api/cron/deploy-gate-runner — bump sweep', () => {
  beforeEach(() => {
    mockParseBumpDirectives.mockReturnValue([
      { id: 'harness:smoke_test_framework', pct: 90, raw: 'BUMP: harness:smoke_test_framework=90' },
    ])
    mockApplyBumps.mockResolvedValue([{ id: 'harness:smoke_test_framework', pct: 90, success: true }])
  })

  it('returns bumps.checked=1 and bumps.applied=1 when commit has BUMP directives', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { sha: 'bumpsha1', commit: { message: 'BUMP: harness:smoke_test_framework=90' } },
        ]),
    })
    mockFrom.mockReturnValue(makeSelectBuilder([]))

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.bumps.checked).toBe(1)
    expect(body.bumps.applied).toBe(1)
    expect(mockApplyBumps).toHaveBeenCalledOnce()
  })

  it('skips commits already in harness_bump_processed and applies nothing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { sha: 'already1', commit: { message: 'BUMP: harness:smoke_test_framework=90' } },
        ]),
    })
    // All queries return the processed sha — bump dedup picks it up
    mockFrom.mockImplementation(() => makeSelectBuilder([{ meta: { sha: 'already1' } }]))

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.bumps.checked).toBe(1)
    expect(body.bumps.applied).toBe(0)
    expect(mockApplyBumps).not.toHaveBeenCalled()
  })

  it('returns bumps.checked=0 applied=0 when fetchMainCommits returns empty', async () => {
    // Default mockFetch (ok: false) causes fetchMainCommits to return [] — early return
    mockFrom.mockReturnValue(makeSelectBuilder([]))

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.bumps.checked).toBe(0)
    expect(body.bumps.applied).toBe(0)
    expect(mockApplyBumps).not.toHaveBeenCalled()
  })
})
