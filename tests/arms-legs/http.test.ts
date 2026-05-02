/**
 * Unit tests for lib/harness/arms-legs/http.ts
 *
 * All external calls are mocked:
 *   - @/lib/security/capability  (requireCapability)
 *   - @/lib/supabase/service     (agent_events logging)
 *   - globalThis.fetch           (the actual HTTP call)
 *
 * Coverage:
 *   - Capability denied (mocked as throw) → httpRequest re-throws
 *   - Capability allowed + URL matches whitelist → fetch is called, result returned
 *   - Capability allowed + URL whitelist mismatch → throws, fetch not called
 *   - Timeout enforced via AbortController
 *   - agent_events row written with correct correlation_id
 *   - 256KB body cap: response body truncated at 256 * 1024 bytes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock requireCapability ────────────────────────────────────────────────────

const { mockRequireCapability } = vi.hoisted(() => ({
  mockRequireCapability: vi.fn(),
}))

vi.mock('@/lib/security/capability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/capability')>()
  return {
    ...actual,
    requireCapability: mockRequireCapability,
  }
})

// ── Mock Supabase (agent_events logging) ─────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Import under test ─────────────────────────────────────────────────────────

import { httpRequest } from '@/lib/harness/arms-legs/http'
import { CapabilityDeniedError } from '@/lib/security/capability'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CAP_AUDIT_ID = 'audit-uuid-1234'

function makeCapAllowed() {
  mockRequireCapability.mockResolvedValue({
    allowed: true,
    reason: 'in_scope',
    enforcement_mode: 'log_only',
    audit_id: CAP_AUDIT_ID,
  })
}

function makeInsertChain() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  return { insert }
}

function makeFetchResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue(makeInsertChain())
  makeCapAllowed()
  mockFetch.mockResolvedValue(makeFetchResponse(200, '{"ok":true}'))
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Capability denied ─────────────────────────────────────────────────────────

describe('httpRequest — capability denied', () => {
  it('re-throws CapabilityDeniedError when requireCapability throws', async () => {
    mockRequireCapability.mockRejectedValue(
      new CapabilityDeniedError('test-agent', 'net.outbound.github', 'no_grant_for_agent')
    )

    await expect(
      httpRequest({
        url: 'https://api.github.com/repos/test/test',
        method: 'GET',
        capability: 'net.outbound.github',
        agentId: 'test-agent',
      })
    ).rejects.toThrow(CapabilityDeniedError)
  })

  it('does not call fetch when capability is denied', async () => {
    mockRequireCapability.mockRejectedValue(
      new CapabilityDeniedError('test-agent', 'net.outbound.github', 'no_grant_for_agent')
    )

    await expect(
      httpRequest({
        url: 'https://api.github.com/repos/test/test',
        method: 'GET',
        capability: 'net.outbound.github',
        agentId: 'test-agent',
      })
    ).rejects.toThrow()

    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── URL whitelist — allowed ───────────────────────────────────────────────────

describe('httpRequest — URL whitelist match', () => {
  it('calls fetch when URL host matches capability allowlist', async () => {
    await httpRequest({
      url: 'https://api.github.com/repos/owner/repo',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'builder',
    })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('https://api.github.com/repos/owner/repo')
  })

  it('returns ok:true + status + body on 200', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse(200, '{"data":1}'))

    const result = await httpRequest({
      url: 'https://api.github.com/repos/owner/repo',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'builder',
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.body).toBe('{"data":1}')
  })

  it('returns ok:false + status on 4xx (capability still allowed)', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse(404, '{"error":"not found"}'))

    const result = await httpRequest({
      url: 'https://api.github.com/repos/owner/missing',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'builder',
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
  })

  it('passes through method and body', async () => {
    await httpRequest({
      url: 'https://api.github.com/repos/owner/repo/issues',
      method: 'POST',
      capability: 'net.outbound.github',
      agentId: 'builder',
      body: { title: 'test' },
    })

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ title: 'test' })
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('calls requireCapability with correct agentId and capability', async () => {
    await httpRequest({
      url: 'https://api.github.com/repos/owner/repo',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'coordinator',
    })

    expect(mockRequireCapability).toHaveBeenCalledOnce()
    expect(mockRequireCapability).toHaveBeenCalledWith({
      agentId: 'coordinator',
      capability: 'net.outbound.github',
    })
  })

  it('capabilities without a host restriction allow any URL', async () => {
    await httpRequest({
      url: 'https://api.vercel.com/v6/deployments',
      method: 'GET',
      capability: 'net.outbound.vercel.read',
      agentId: 'coordinator',
    })

    expect(mockFetch).toHaveBeenCalledOnce()
  })
})

// ── URL whitelist — mismatch ──────────────────────────────────────────────────

describe('httpRequest — URL whitelist mismatch', () => {
  it('throws when URL host does not match capability allowlist', async () => {
    await expect(
      httpRequest({
        url: 'https://evil.example.com/steal',
        method: 'GET',
        capability: 'net.outbound.github',
        agentId: 'builder',
      })
    ).rejects.toThrow(/not allowed for capability/)
  })

  it('does not call fetch when URL is mismatched', async () => {
    await expect(
      httpRequest({
        url: 'https://evil.example.com/steal',
        method: 'GET',
        capability: 'net.outbound.github',
        agentId: 'builder',
      })
    ).rejects.toThrow()

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws for anthropic capability with non-anthropic host', async () => {
    await expect(
      httpRequest({
        url: 'https://openai.com/v1/chat/completions',
        method: 'POST',
        capability: 'net.outbound.anthropic',
        agentId: 'builder',
        body: { model: 'gpt-4' },
      })
    ).rejects.toThrow(/not allowed for capability "net.outbound.anthropic"/)
  })
})

// ── Timeout ───────────────────────────────────────────────────────────────────

describe('httpRequest — timeout', () => {
  it('returns ok:false with error when fetch times out', async () => {
    vi.useFakeTimers()

    mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        opts.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })

    const promise = httpRequest({
      url: 'https://api.github.com/slow',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'builder',
      timeoutMs: 100,
    })

    await vi.advanceTimersByTimeAsync(101)
    const result = await promise

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('clamps timeoutMs to MAX_TIMEOUT_MS (60s)', async () => {
    vi.useFakeTimers()

    let capturedSignal: AbortSignal | undefined
    mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
      capturedSignal = opts.signal ?? undefined
      return new Promise<Response>(() => {})
    })

    void httpRequest({
      url: 'https://api.github.com/slow',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'builder',
      timeoutMs: 999_999,
    })

    // At 59s the signal should not be aborted
    await vi.advanceTimersByTimeAsync(59_000)
    expect(capturedSignal?.aborted).toBe(false)

    // At 60s it should be aborted
    await vi.advanceTimersByTimeAsync(1_001)
    expect(capturedSignal?.aborted).toBe(true)
  })
})

// ── agent_events logging ──────────────────────────────────────────────────────

describe('httpRequest — agent_events logging', () => {
  it('writes agent_events row with correlation_id matching capResult.audit_id', async () => {
    const b = makeInsertChain()
    mockFrom.mockReturnValue(b)

    await httpRequest({
      url: 'https://api.github.com/repos/owner/repo',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'builder',
    })

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const row = b.insert.mock.calls[0][0] as {
      meta: {
        correlation_id: string
        status: number
        durationMs: number
        host: string
        method: string
      }
      domain: string
      action: string
      actor: string
    }
    expect(row.meta.correlation_id).toBe(CAP_AUDIT_ID)
    expect(row.meta.host).toBe('api.github.com')
    expect(typeof row.meta.durationMs).toBe('number')
    expect(row.domain).toBe('arms_legs')
    expect(row.actor).toBe('builder')
  })

  it('sets action to arms_legs.http.ok on 2xx', async () => {
    const b = makeInsertChain()
    mockFrom.mockReturnValue(b)

    mockFetch.mockResolvedValue(makeFetchResponse(200, 'ok'))

    await httpRequest({
      url: 'https://api.github.com/repos/owner/repo',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'builder',
    })

    const row = b.insert.mock.calls[0][0] as { action: string }
    expect(row.action).toBe('arms_legs.http.ok')
  })

  it('sets action to arms_legs.http.error on 4xx', async () => {
    const b = makeInsertChain()
    mockFrom.mockReturnValue(b)

    mockFetch.mockResolvedValue(makeFetchResponse(404, 'not found'))

    await httpRequest({
      url: 'https://api.github.com/repos/owner/repo',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'builder',
    })

    const row = b.insert.mock.calls[0][0] as { action: string }
    expect(row.action).toBe('arms_legs.http.error')
  })

  it('does not throw when agent_events insert fails', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockRejectedValue(new Error('DB down')),
    })

    const result = await httpRequest({
      url: 'https://api.github.com/repos/owner/repo',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'builder',
    })

    expect(result.ok).toBe(true)
  })
})

// ── 256KB body cap ────────────────────────────────────────────────────────────

describe('httpRequest — 256KB body cap', () => {
  it('truncates response body larger than 256KB', async () => {
    const oversized = 'x'.repeat(300 * 1024)
    mockFetch.mockResolvedValue(makeFetchResponse(200, oversized))

    const result = await httpRequest({
      url: 'https://api.github.com/repos/owner/repo',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'builder',
    })

    expect(result.body.length).toBeLessThanOrEqual(256 * 1024)
    expect(result.body.length).toBe(256 * 1024)
  })

  it('does not truncate response body at or under 256KB', async () => {
    const exactly256 = 'y'.repeat(256 * 1024)
    mockFetch.mockResolvedValue(makeFetchResponse(200, exactly256))

    const result = await httpRequest({
      url: 'https://api.github.com/repos/owner/repo',
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'builder',
    })

    expect(result.body.length).toBe(256 * 1024)
  })
})
