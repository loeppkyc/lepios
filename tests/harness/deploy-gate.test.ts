/**
 * Tests for lib/harness/deploy-gate.ts (findPreviewDeployment)
 * and app/api/cron/deploy-gate-runner/route.ts (gate runner cron).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockInsert, mockFrom } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockFrom = vi.fn()
  return { mockInsert, mockFrom }
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { findPreviewDeployment, runSmokeCheck } from '@/lib/harness/deploy-gate'
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
  delete process.env.VERCEL_TEAM_ID
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.VERCEL_TOKEN
  delete process.env.VERCEL_PROJECT_ID
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
      .mockReturnValueOnce(makeSelectBuilder([trigger])) // triggers query
      .mockReturnValueOnce(makeSelectBuilder([])) // terminal rows
      .mockReturnValueOnce(makeSelectBuilder([])) // processing markers
      .mockReturnValue(makeInsertBuilder()) // subsequent inserts

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, commit: null, timestamp: new Date().toISOString() }),
      })
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(1)
    expect(body.results[0]).toContain('ready')

    // processing marker + preview_ready + smoke_preview = 3 inserts
    expect(mockInsert).toHaveBeenCalledTimes(3)

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
  })

  it('leaves building triggers in place (no outcome row written)', async () => {
    const trigger = makeTriggerRow('building1', 3)

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
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
  it('skips trigger that already has a deploy_gate_preview_ready row', async () => {
    const trigger = makeTriggerRow('abc1234', 3)
    const terminalRow = { id: 'x', meta: { commit_sha: 'abc1234' } }

    mockFrom
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
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.results[0]).toContain('timeout')

    // processing marker + timeout failure = 2 inserts; no Vercel API call
    expect(mockInsert).toHaveBeenCalledTimes(2)
    expect(mockFetch).not.toHaveBeenCalled()

    const timeoutRow = mockInsert.mock.calls[1][0]
    expect(timeoutRow.task_type).toBe('deploy_gate_failed')
    expect(timeoutRow.status).toBe('error')
    expect(timeoutRow.meta.reason).toBe('preview_timeout')
    expect(timeoutRow.meta.commit_sha).toBe('old1234')
  })

  it('does not write timeout for trigger exactly at the 10-minute boundary (still polling)', async () => {
    const trigger = makeTriggerRow('edge1', 9) // 9 minutes ago — under timeout

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
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
      .mockReturnValueOnce(makeSelectBuilder(triggers)) // all 6 returned by DB
      .mockReturnValueOnce(makeSelectBuilder([])) // no terminal rows
      .mockReturnValueOnce(makeSelectBuilder([])) // no processing markers
      .mockReturnValue(makeInsertBuilder()) // all inserts

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
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
    // 3 inserts per trigger (processing + preview_ready + smoke_preview) × 5 = 15
    expect(mockInsert).toHaveBeenCalledTimes(15)

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
      json: () => Promise.resolve({ ok: true, commit: 'abc', timestamp: '2026-01-01T00:00:00.000Z' }),
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
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValue(makeInsertBuilder())

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('api.vercel.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deployments: [makeVercelDeployment('READY')] }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, commit: null, timestamp: new Date().toISOString() }),
      })
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)

    // processing + preview_ready + smoke_preview = 3 inserts
    expect(mockInsert).toHaveBeenCalledTimes(3)

    const smokeRow = mockInsert.mock.calls[2][0]
    expect(smokeRow.task_type).toBe('deploy_gate_smoke_preview')
    expect(smokeRow.status).toBe('success')
    expect(smokeRow.meta.commit_sha).toBe('f3f43eb')
    expect(smokeRow.meta.preview_url).toBe('https://preview-abc.vercel.app')
    expect(smokeRow.meta.status_code).toBe(200)
  })

  it('writes deploy_gate_smoke_preview:error when smoke returns non-200', async () => {
    const trigger = makeTriggerRow('f3f43eb', 3)

    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
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
      .mockReturnValueOnce(makeSelectBuilder([trigger]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
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
