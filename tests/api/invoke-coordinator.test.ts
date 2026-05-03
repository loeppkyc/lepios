import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Mock arms-legs httpRequest — bypass capability gate + audit logging ───────
vi.mock('@/lib/harness/arms-legs/http', () => ({
  httpRequest: vi.fn(
    async (args: {
      url: string
      method: string
      body?: unknown
      headers?: Record<string, string>
    }) => {
      const hdrs: Record<string, string> = { ...(args.headers ?? {}) }
      let fetchBody: string | null = null
      if (args.body != null) {
        fetchBody = JSON.stringify(args.body)
        if (!hdrs['Content-Type']) hdrs['Content-Type'] = 'application/json'
      }
      try {
        const res = (await fetch(args.url, {
          method: args.method,
          headers: hdrs,
          body: fetchBody,
        })) as {
          ok: boolean
          status?: number
          text?: () => Promise<string>
          headers?: { forEach?: (cb: (v: string, k: string) => void) => void }
        }
        const text = typeof res.text === 'function' ? await res.text() : ''
        const resHeaders: Record<string, string> = {}
        res.headers?.forEach?.((v, k) => {
          resHeaders[k] = v
        })
        return {
          ok: Boolean(res.ok),
          status: res.status ?? (res.ok ? 200 : 500),
          body: text,
          headers: resHeaders,
          durationMs: 0,
        }
      } catch (err) {
        return {
          ok: false,
          status: 0,
          body: '',
          headers: {},
          durationMs: 0,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }
  ),
}))

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { POST } from '@/app/api/harness/invoke-coordinator/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-cron-secret-xyz'
const VALID_TASK_ID = '885ff1e3-baed-4512-8e7a-8335995ea057'
const VALID_RUN_ID = 'pickup-run-abc123'
const VALID_ROUTINE_ID = 'trig_01AC9K3asFWrHZpK7HrRBhak'
const VALID_ROUTINE_TOKEN = 'sk-ant-oat01-test-token'

const FIRE_SUCCESS_BODY = {
  type: 'routine_fire',
  claude_code_session_id: 'session_01TestSessionId',
  claude_code_session_url: 'https://claude.ai/code/session_01TestSessionId',
}

const VALID_BODY = { task_id: VALID_TASK_ID, run_id: VALID_RUN_ID }

function makeRequest(body: object, headerOverrides: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/harness/invoke-coordinator', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VALID_SECRET}`,
      ...headerOverrides,
    },
    body: JSON.stringify(body),
  })
}

function makeInsertBuilder() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  return { insert }
}

function makeFireResponse(
  status: number,
  body: object,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = VALID_SECRET
  process.env.COORDINATOR_ROUTINE_ID = VALID_ROUTINE_ID
  process.env.COORDINATOR_ROUTINE_TOKEN = VALID_ROUTINE_TOKEN
  mockFrom.mockReturnValue(makeInsertBuilder())
  mockFetch.mockResolvedValue(makeFireResponse(200, FIRE_SUCCESS_BODY))
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.COORDINATOR_ROUTINE_ID
  delete process.env.COORDINATOR_ROUTINE_TOKEN
})

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('POST /api/harness/invoke-coordinator — auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest(VALID_BODY, { Authorization: '' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    const req = makeRequest(VALID_BODY, { Authorization: 'Bearer wrong-secret' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('does not call fetch or write agent_events on unauthorized request', async () => {
    const req = makeRequest(VALID_BODY, { Authorization: 'Bearer wrong' })
    await POST(req)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── Env var validation ────────────────────────────────────────────────────────

describe('POST /api/harness/invoke-coordinator — env vars', () => {
  it('returns 500 when COORDINATOR_ROUTINE_ID is missing', async () => {
    delete process.env.COORDINATOR_ROUTINE_ID
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 500 when COORDINATOR_ROUTINE_TOKEN is missing', async () => {
    delete process.env.COORDINATOR_ROUTINE_TOKEN
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('writes error event to agent_events when env vars are missing', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    delete process.env.COORDINATOR_ROUTINE_ID

    const req = makeRequest(VALID_BODY)
    await POST(req)

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('error')
    expect(row.meta.error).toBe('missing_env_vars')
  })

  it('does not call fetch when env vars are missing', async () => {
    delete process.env.COORDINATOR_ROUTINE_ID
    const req = makeRequest(VALID_BODY)
    await POST(req)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── Input validation ──────────────────────────────────────────────────────────

describe('POST /api/harness/invoke-coordinator — validation', () => {
  it('returns 400 when task_id is not a valid UUID', async () => {
    const req = makeRequest({ ...VALID_BODY, task_id: 'not-a-uuid' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })

  it('returns 400 when task_id is missing', async () => {
    const { task_id: _, ...bodyWithout } = VALID_BODY
    const req = makeRequest(bodyWithout)
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when run_id is empty string', async () => {
    const req = makeRequest({ ...VALID_BODY, run_id: '' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('does not call fetch or write agent_events on validation failure', async () => {
    const req = makeRequest({ ...VALID_BODY, task_id: 'not-a-uuid' })
    await POST(req)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/harness/invoke-coordinator — happy path', () => {
  it('returns 200 with ok:true, session_id, and session_url', async () => {
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.session_id).toBe(FIRE_SUCCESS_BODY.claude_code_session_id)
    expect(body.session_url).toBe(FIRE_SUCCESS_BODY.claude_code_session_url)
  })

  it('calls the Routines API with correct URL, headers, and body', async () => {
    const req = makeRequest(VALID_BODY)
    await POST(req)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://api.anthropic.com/v1/claude_code/routines/${VALID_ROUTINE_ID}/fire`)
    expect((options.headers as Record<string, string>)['Authorization']).toBe(
      `Bearer ${VALID_ROUTINE_TOKEN}`
    )
    expect((options.headers as Record<string, string>)['anthropic-beta']).toBe(
      'experimental-cc-routine-2026-04-01'
    )
    const sentBody = JSON.parse(options.body as string) as { text: string }
    expect(sentBody.text).toBe(`task_id: ${VALID_TASK_ID}\nrun_id: ${VALID_RUN_ID}`)
  })

  it('fire body contains only { text } — no branch field (Routines API ignores it)', async () => {
    const req = makeRequest(VALID_BODY)
    await POST(req)

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const sentBody = JSON.parse(options.body as string) as Record<string, unknown>
    expect(Object.keys(sentBody)).toEqual(['text'])
    expect('branch' in sentBody).toBe(false)
  })

  it('writes coordinator_invoked event with status=success', async () => {
    const agentEventsBuilder = makeInsertBuilder()
    const attributionBuilder = makeInsertBuilder()
    // Route by table: attribution fires synchronously before agent_events
    mockFrom.mockImplementation((table: string) => {
      if (table === 'entity_attribution') return attributionBuilder
      return agentEventsBuilder
    })

    const req = makeRequest(VALID_BODY)
    await POST(req)

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const row = agentEventsBuilder.insert.mock.calls[0][0]
    expect(row.task_type).toBe('coordinator_invoked')
    expect(row.status).toBe('success')
  })

  it('event meta contains task_id, run_id, session_id, and routine_id', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    const req = makeRequest(VALID_BODY)
    await POST(req)

    const row = b.insert.mock.calls[0][0]
    expect(row.meta.task_id).toBe(VALID_TASK_ID)
    expect(row.meta.run_id).toBe(VALID_RUN_ID)
    expect(row.meta.session_id).toBe(FIRE_SUCCESS_BODY.claude_code_session_id)
    expect(row.meta.routine_id).toBe(VALID_ROUTINE_ID)
  })

  it('calls fetch exactly once — no retry', async () => {
    const req = makeRequest(VALID_BODY)
    await POST(req)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

// ── Upstream failures ─────────────────────────────────────────────────────────

describe('POST /api/harness/invoke-coordinator — upstream failure', () => {
  it('returns 503 when Routines API returns 400 (paused)', async () => {
    mockFetch.mockResolvedValue(
      makeFireResponse(400, {
        error: {
          message: 'Routine is paused.',
          reason: 'routine_paused',
          type: 'invalid_request_error',
        },
        type: 'error',
      })
    )
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 429 when Routines API returns 429', async () => {
    mockFetch.mockResolvedValue(
      makeFireResponse(429, { error: { message: 'Rate limit exceeded.' } }, { 'retry-after': '60' })
    )
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('logs retry-after to event meta on 429', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    mockFetch.mockResolvedValue(
      makeFireResponse(429, { error: { message: 'Rate limit exceeded.' } }, { 'retry-after': '60' })
    )

    const req = makeRequest(VALID_BODY)
    await POST(req)

    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('error')
    expect(row.meta.retry_after).toBe('60')
  })

  it('returns 503 on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('writes error event to agent_events on upstream failure', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    mockFetch.mockResolvedValue(makeFireResponse(400, { error: { message: 'Routine is paused.' } }))

    const req = makeRequest(VALID_BODY)
    await POST(req)

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('error')
    expect(row.meta.task_id).toBe(VALID_TASK_ID)
  })

  it('calls fetch exactly once on failure — no retry', async () => {
    mockFetch.mockResolvedValue(makeFireResponse(400, { error: { message: 'Routine is paused.' } }))
    const req = makeRequest(VALID_BODY)
    await POST(req)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
