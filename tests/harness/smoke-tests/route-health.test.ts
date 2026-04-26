/**
 * Tests for lib/harness/smoke-tests/route-health.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockInsert, mockFrom, mockMaybeSingle } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockMaybeSingle = vi.fn()
  const mockFrom = vi.fn()
  return { mockInsert, mockFrom, mockMaybeSingle }
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { runRouteHealthSmoke } from '@/lib/harness/smoke-tests/route-health'

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_URL = 'https://lepios-one.vercel.app'

function makeInsertBuilder() {
  return { insert: mockInsert }
}

// Thenable select builder for harness_config reads.
// Supports .select().eq().maybeSingle() chain.
function makeConfigSelectBuilder(value: string | null) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue(
      value !== null ? { data: { value }, error: null } : { data: null, error: null }
    )
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  return { select, insert: mockInsert }
}

const mockFetch = vi.fn()

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Helper: make fetch respond per URL ───────────────────────────────────────

function makePassingFetch() {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/health')) {
      return Promise.resolve({ ok: true, status: 200 })
    }
    if (url.includes('/api/twin/ask')) {
      return Promise.resolve({ ok: true, status: 200 })
    }
    if (url.includes('/api/telegram/webhook')) {
      return Promise.resolve({ ok: false, status: 405 })
    }
    return Promise.resolve({ ok: false, status: 500 })
  })
}

// ── Test 1: All routes pass ───────────────────────────────────────────────────

describe('runRouteHealthSmoke — all routes pass', () => {
  it('returns passed=true when all routes return expected status codes', async () => {
    makePassingFetch()
    mockFrom.mockReturnValue(makeInsertBuilder())

    const result = await runRouteHealthSmoke(BASE_URL, 'abc1234def')

    expect(result.passed).toBe(true)
    expect(result.failed_routes).toHaveLength(0)
    expect(result.routes).toHaveLength(3)
    expect(result.total_ms).toBeGreaterThanOrEqual(0)
  })

  it('inserts agent_events with action=smoke_test_passed on all-pass', async () => {
    makePassingFetch()
    mockFrom.mockReturnValue(makeInsertBuilder())

    await runRouteHealthSmoke(BASE_URL, 'abc1234')

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const insertCall = mockInsert.mock.calls[0][0]
    expect(insertCall.action).toBe('smoke_test_passed')
    expect(insertCall.domain).toBe('harness')
    expect(insertCall.actor).toBe('route-health')
    expect(insertCall.status).toBe('success')
    expect(insertCall.meta.base_url).toBe(BASE_URL)
    expect(insertCall.meta.routes).toHaveLength(3)
  })

  it('does NOT insert outbound_notifications on all-pass', async () => {
    makePassingFetch()
    mockFrom.mockReturnValue(makeInsertBuilder())

    await runRouteHealthSmoke(BASE_URL, 'abc1234')

    const notifCalls = mockFrom.mock.calls.filter(
      (c: unknown[]) => c[0] === 'outbound_notifications'
    )
    expect(notifCalls).toHaveLength(0)
  })

  it('does NOT insert task_queue on all-pass', async () => {
    makePassingFetch()
    mockFrom.mockReturnValue(makeInsertBuilder())

    await runRouteHealthSmoke(BASE_URL, 'abc1234')

    const taskCalls = mockFrom.mock.calls.filter((c: unknown[]) => c[0] === 'task_queue')
    expect(taskCalls).toHaveLength(0)
  })

  it('all RouteResult entries have passed=true', async () => {
    makePassingFetch()
    mockFrom.mockReturnValue(makeInsertBuilder())

    const result = await runRouteHealthSmoke(BASE_URL)

    for (const r of result.routes) {
      expect(r.passed).toBe(true)
      expect(r.detail).toBeUndefined()
    }
  })
})

// ── Test 2: One route fails ───────────────────────────────────────────────────

describe('runRouteHealthSmoke — one route fails (POST /api/twin/ask returns 500)', () => {
  beforeEach(() => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/health')) {
        return Promise.resolve({ ok: true, status: 200 })
      }
      if (url.includes('/api/twin/ask')) {
        return Promise.resolve({ ok: false, status: 500 })
      }
      if (url.includes('/api/telegram/webhook')) {
        return Promise.resolve({ ok: false, status: 405 })
      }
      return Promise.resolve({ ok: false, status: 500 })
    })
    // From calls: harness_config read, then agent_events, outbound_notifications, task_queue
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') {
        return makeConfigSelectBuilder('123456')
      }
      return makeInsertBuilder()
    })
  })

  it('returns passed=false', async () => {
    const result = await runRouteHealthSmoke(BASE_URL, 'deadbeef')
    expect(result.passed).toBe(false)
  })

  it('includes /api/twin/ask in failed_routes', async () => {
    const result = await runRouteHealthSmoke(BASE_URL, 'deadbeef')
    expect(result.failed_routes).toContain('/api/twin/ask')
  })

  it('does not include passing routes in failed_routes', async () => {
    const result = await runRouteHealthSmoke(BASE_URL, 'deadbeef')
    expect(result.failed_routes).not.toContain('/api/health')
    expect(result.failed_routes).not.toContain('/api/telegram/webhook')
  })

  it('inserts agent_events with action=smoke_test_failed', async () => {
    await runRouteHealthSmoke(BASE_URL, 'deadbeef')

    const agentEventsCalls = mockFrom.mock.calls.filter((c: unknown[]) => c[0] === 'agent_events')
    expect(agentEventsCalls.length).toBeGreaterThanOrEqual(1)

    // Find the smoke_test_failed insert
    const failInsert = mockInsert.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'object' &&
        c[0] !== null &&
        (c[0] as Record<string, unknown>).action === 'smoke_test_failed'
    )
    expect(failInsert).toBeDefined()
    const row = failInsert![0] as Record<string, unknown>
    expect(row.status).toBe('error')
    expect(row.domain).toBe('harness')
    expect((row.meta as Record<string, unknown>).failed_routes).toContain('/api/twin/ask')
  })

  it('inserts outbound_notifications row with text containing failed route', async () => {
    await runRouteHealthSmoke(BASE_URL, 'deadbeef')

    const notifCalls = mockFrom.mock.calls.filter(
      (c: unknown[]) => c[0] === 'outbound_notifications'
    )
    expect(notifCalls.length).toBe(1)

    const notifInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.channel === 'telegram'
    })
    expect(notifInsert).toBeDefined()
    const row = notifInsert![0] as Record<string, unknown>
    expect((row.payload as Record<string, unknown>).text).toContain('/api/twin/ask')
    expect(row.correlation_id).toContain('smoke-fail-')
    expect(row.requires_response).toBe(false)
  })

  it('inserts task_queue row with priority=1', async () => {
    await runRouteHealthSmoke(BASE_URL, 'deadbeef')

    const taskCalls = mockFrom.mock.calls.filter((c: unknown[]) => c[0] === 'task_queue')
    expect(taskCalls.length).toBe(1)

    const taskInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.priority === 1
    })
    expect(taskInsert).toBeDefined()
    const row = taskInsert![0] as Record<string, unknown>
    expect(row.priority).toBe(1)
    expect(row.source).toBe('cron')
    expect(row.task).toBe('Investigate production smoke test failure')
    expect(row.description).toContain('/api/twin/ask')
  })
})

// ── Test 3: Route unreachable (timeout / network error) ───────────────────────

describe('runRouteHealthSmoke — route unreachable (timeout)', () => {
  it('records status=null and detail mentioning timeout on AbortError', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/health')) {
        return Promise.reject(abortError)
      }
      if (url.includes('/api/twin/ask')) {
        return Promise.resolve({ ok: true, status: 200 })
      }
      if (url.includes('/api/telegram/webhook')) {
        return Promise.resolve({ ok: false, status: 405 })
      }
      return Promise.resolve({ ok: false, status: 500 })
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') {
        return makeConfigSelectBuilder('123456')
      }
      return makeInsertBuilder()
    })

    const result = await runRouteHealthSmoke(BASE_URL, 'abc1234')

    const healthRoute = result.routes.find((r) => r.path === '/api/health')
    expect(healthRoute).toBeDefined()
    expect(healthRoute!.status).toBeNull()
    expect(healthRoute!.passed).toBe(false)
    expect(healthRoute!.detail).toContain('timeout')
  })

  it('records status=null and detail with error message on generic network error', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/health')) {
        return Promise.reject(new Error('ECONNREFUSED'))
      }
      if (url.includes('/api/twin/ask')) {
        return Promise.resolve({ ok: true, status: 200 })
      }
      if (url.includes('/api/telegram/webhook')) {
        return Promise.resolve({ ok: false, status: 405 })
      }
      return Promise.resolve({ ok: false, status: 500 })
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') {
        return makeConfigSelectBuilder('123456')
      }
      return makeInsertBuilder()
    })

    const result = await runRouteHealthSmoke(BASE_URL, 'abc1234')

    const healthRoute = result.routes.find((r) => r.path === '/api/health')
    expect(healthRoute!.status).toBeNull()
    expect(healthRoute!.passed).toBe(false)
    expect(healthRoute!.detail).toBe('ECONNREFUSED')
  })

  it('treats timeout route as a failure — passed=false overall', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'

    mockFetch.mockRejectedValue(abortError)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') {
        return makeConfigSelectBuilder('123456')
      }
      return makeInsertBuilder()
    })

    const result = await runRouteHealthSmoke(BASE_URL)
    expect(result.passed).toBe(false)
    expect(result.failed_routes).toHaveLength(3) // all timed out
  })
})

// ── Test 4: Mixed — 3 routes, 1 fails ─────────────────────────────────────────

describe('runRouteHealthSmoke — mixed results', () => {
  it('only includes the failed route in failed_routes, passing routes show passed=true', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/health')) {
        return Promise.resolve({ ok: true, status: 200 })
      }
      if (url.includes('/api/twin/ask')) {
        return Promise.resolve({ ok: false, status: 503 }) // wrong status
      }
      if (url.includes('/api/telegram/webhook')) {
        return Promise.resolve({ ok: false, status: 405 })
      }
      return Promise.resolve({ ok: false, status: 500 })
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') {
        return makeConfigSelectBuilder('123456')
      }
      return makeInsertBuilder()
    })

    const result = await runRouteHealthSmoke(BASE_URL, 'abc12345')

    expect(result.failed_routes).toEqual(['/api/twin/ask'])
    expect(result.failed_routes).toHaveLength(1)

    const healthRoute = result.routes.find((r) => r.path === '/api/health')
    const twinRoute = result.routes.find((r) => r.path === '/api/twin/ask')
    const webhookRoute = result.routes.find((r) => r.path === '/api/telegram/webhook')

    expect(healthRoute!.passed).toBe(true)
    expect(twinRoute!.passed).toBe(false)
    expect(webhookRoute!.passed).toBe(true)
  })

  it('result.routes contains all 3 routes regardless of pass/fail', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/health')) return Promise.resolve({ ok: false, status: 503 })
      if (url.includes('/api/twin/ask')) return Promise.resolve({ ok: true, status: 200 })
      if (url.includes('/api/telegram/webhook')) return Promise.resolve({ ok: false, status: 405 })
      return Promise.resolve({ ok: false, status: 500 })
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') return makeConfigSelectBuilder('123456')
      return makeInsertBuilder()
    })

    const result = await runRouteHealthSmoke(BASE_URL)

    expect(result.routes).toHaveLength(3)
    expect(result.failed_routes).toEqual(['/api/health'])
  })
})

// ── Test 5: commitSha provided — correlation_id uses first 8 chars ────────────

describe('runRouteHealthSmoke — correlation_id with commitSha', () => {
  beforeEach(() => {
    mockFetch.mockImplementation((url: string) => {
      // Make one route fail so we get an outbound_notification insert
      if (url.includes('/api/health')) return Promise.resolve({ ok: false, status: 503 })
      if (url.includes('/api/twin/ask')) return Promise.resolve({ ok: true, status: 200 })
      if (url.includes('/api/telegram/webhook')) return Promise.resolve({ ok: false, status: 405 })
      return Promise.resolve({ ok: false, status: 500 })
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') return makeConfigSelectBuilder('123456')
      return makeInsertBuilder()
    })
  })

  it('uses first 8 chars of commitSha in correlation_id', async () => {
    const commitSha = 'abcdef1234567890'

    await runRouteHealthSmoke(BASE_URL, commitSha)

    const notifInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.channel === 'telegram'
    })
    expect(notifInsert).toBeDefined()
    const row = notifInsert![0] as Record<string, unknown>
    expect(row.correlation_id).toBe('smoke-fail-abcdef12')
  })
})

// ── Test 6: commitSha absent — correlation_id uses 'unknown' ─────────────────

describe('runRouteHealthSmoke — correlation_id without commitSha', () => {
  beforeEach(() => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/health')) return Promise.resolve({ ok: false, status: 503 })
      if (url.includes('/api/twin/ask')) return Promise.resolve({ ok: true, status: 200 })
      if (url.includes('/api/telegram/webhook')) return Promise.resolve({ ok: false, status: 405 })
      return Promise.resolve({ ok: false, status: 500 })
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') return makeConfigSelectBuilder('123456')
      return makeInsertBuilder()
    })
  })

  it('uses unknown in correlation_id when commitSha is not provided', async () => {
    await runRouteHealthSmoke(BASE_URL) // no commitSha

    const notifInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.channel === 'telegram'
    })
    expect(notifInsert).toBeDefined()
    const row = notifInsert![0] as Record<string, unknown>
    expect(row.correlation_id).toBe('smoke-fail-unknown')
  })

  it('stores null for commit_sha in task_queue metadata when not provided', async () => {
    await runRouteHealthSmoke(BASE_URL)

    const taskInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.priority === 1
    })
    expect(taskInsert).toBeDefined()
    const row = taskInsert![0] as Record<string, unknown>
    const metadata = row.metadata as Record<string, unknown>
    expect(metadata.commit_sha).toBeNull()
  })
})

// ── Additional: chat_id from harness_config ───────────────────────────────────

describe('runRouteHealthSmoke — chat_id propagation', () => {
  beforeEach(() => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/health')) return Promise.resolve({ ok: false, status: 503 })
      if (url.includes('/api/twin/ask')) return Promise.resolve({ ok: true, status: 200 })
      if (url.includes('/api/telegram/webhook')) return Promise.resolve({ ok: false, status: 405 })
      return Promise.resolve({ ok: false, status: 500 })
    })
  })

  it('includes chat_id in notification when harness_config returns a value', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') return makeConfigSelectBuilder('987654')
      return makeInsertBuilder()
    })

    await runRouteHealthSmoke(BASE_URL, 'abc1234')

    const notifInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.channel === 'telegram'
    })
    expect(notifInsert).toBeDefined()
    const row = notifInsert![0] as Record<string, unknown>
    expect(row.chat_id).toBe('987654')
  })

  it('omits chat_id when harness_config returns null', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') return makeConfigSelectBuilder(null)
      return makeInsertBuilder()
    })

    await runRouteHealthSmoke(BASE_URL, 'abc1234')

    const notifInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.channel === 'telegram'
    })
    expect(notifInsert).toBeDefined()
    const row = notifInsert![0] as Record<string, unknown>
    expect(row.chat_id).toBeUndefined()
  })
})

// ── Additional: route method and body correctness ─────────────────────────────

describe('runRouteHealthSmoke — fetch call shape', () => {
  it('calls /api/health with GET and no body', async () => {
    makePassingFetch()
    mockFrom.mockReturnValue(makeInsertBuilder())

    await runRouteHealthSmoke(BASE_URL, 'abc1234')

    const healthCall = mockFetch.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes('/api/health')
    )
    expect(healthCall).toBeDefined()
    const opts = healthCall![1] as RequestInit
    expect(opts.method).toBe('GET')
    expect(opts.body).toBeUndefined()
  })

  it('calls /api/twin/ask with POST and JSON body { question: "smoke test" }', async () => {
    makePassingFetch()
    mockFrom.mockReturnValue(makeInsertBuilder())

    await runRouteHealthSmoke(BASE_URL, 'abc1234')

    const twinCall = mockFetch.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes('/api/twin/ask')
    )
    expect(twinCall).toBeDefined()
    const opts = twinCall![1] as RequestInit
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body as string)
    expect(body).toEqual({ question: 'smoke test' })
  })

  it('calls /api/telegram/webhook with GET and expects 405', async () => {
    makePassingFetch()
    mockFrom.mockReturnValue(makeInsertBuilder())

    await runRouteHealthSmoke(BASE_URL, 'abc1234')

    const webhookCall = mockFetch.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes('/api/telegram/webhook')
    )
    expect(webhookCall).toBeDefined()
    const opts = webhookCall![1] as RequestInit
    expect(opts.method).toBe('GET')
  })
})

// ── Additional: route detail field on failure ─────────────────────────────────

describe('runRouteHealthSmoke — failure detail field', () => {
  it('populates detail with expected vs actual status on HTTP mismatch', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/health')) return Promise.resolve({ ok: false, status: 503 })
      if (url.includes('/api/twin/ask')) return Promise.resolve({ ok: true, status: 200 })
      if (url.includes('/api/telegram/webhook')) return Promise.resolve({ ok: false, status: 405 })
      return Promise.resolve({ ok: false, status: 500 })
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') return makeConfigSelectBuilder('123456')
      return makeInsertBuilder()
    })

    const result = await runRouteHealthSmoke(BASE_URL)

    const healthRoute = result.routes.find((r) => r.path === '/api/health')
    expect(healthRoute!.detail).toContain('200')
    expect(healthRoute!.detail).toContain('503')
  })
})
