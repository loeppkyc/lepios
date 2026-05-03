import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

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

import { checkSiteHealth } from '@/lib/orchestrator/checks/site-health'

function makeDbBuilder(error: null | { message: string }) {
  const result = { data: error ? null : [{ id: '1' }], error }
  return {
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (v: typeof result) => void) => Promise.resolve(result).then(resolve),
  }
}

function stubFetchOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('{"ok":true}'),
      headers: { forEach: vi.fn() },
    })
  )
}

function stubFetchFail() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))
}

beforeEach(() => {
  vi.clearAllMocks()
  stubFetchOk()
})

afterEach(() => vi.unstubAllGlobals())

describe('checkSiteHealth', () => {
  it('returns pass when all three sub-checks succeed', async () => {
    mockFrom.mockReturnValue(makeDbBuilder(null))
    const result = await checkSiteHealth()
    expect(result.name).toBe('site_health')
    expect(result.status).toBe('pass')
    expect(result.flags).toHaveLength(0)
    expect(result.counts.pass).toBe(3)
    expect(result.counts.fail).toBe(0)
  })

  it('returns fail when both db checks fail (all 3 sub-checks fail)', async () => {
    mockFrom.mockReturnValue(makeDbBuilder({ message: 'db down' }))
    stubFetchFail()
    const result = await checkSiteHealth()
    expect(result.status).toBe('fail')
    expect(result.counts.fail).toBe(3)
  })

  it('returns warn when only the /api/health fetch fails', async () => {
    // (a) agent_events ok, (b) knowledge ok, (c) fetch fails
    mockFrom.mockReturnValue(makeDbBuilder(null))
    stubFetchFail()
    const result = await checkSiteHealth()
    expect(result.status).toBe('warn')
    expect(result.counts.pass).toBe(2)
    expect(result.counts.fail).toBe(1)
  })

  it('flags db unreachable with critical severity', async () => {
    mockFrom.mockReturnValue(makeDbBuilder({ message: 'connection refused' }))
    const result = await checkSiteHealth()
    const flag = result.flags.find((f) => f.entity_type === 'database')
    expect(flag).toBeDefined()
    expect(flag!.severity).toBe('critical')
  })

  it('flags /api/health failure with warn severity', async () => {
    mockFrom.mockReturnValue(makeDbBuilder(null))
    stubFetchFail()
    const result = await checkSiteHealth()
    const flag = result.flags.find((f) => f.entity_type === 'route')
    expect(flag!.severity).toBe('warn')
  })

  it('never throws even when supabase client throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('client crash')
    })
    await expect(checkSiteHealth()).resolves.toBeDefined()
  })

  it('includes duration_ms >= 0', async () => {
    mockFrom.mockReturnValue(makeDbBuilder(null))
    const result = await checkSiteHealth()
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })
})
