/**
 * Tests for lib/ollama/circuit.ts and circuit-integrated generate().
 *
 * Mocks:
 *   @/lib/supabase/service — controls agent_events + outbound_notifications
 *   @/lib/knowledge/client — logEvent (fire-and-forget)
 *   fetch (global) — Ollama HTTP calls
 *
 * No real HTTP or Supabase connections made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mock state — accessible in vi.mock factory ────────────────────────

const { getQueryRows, setQueryRows, notificationsInsert } = vi.hoisted(() => {
  let rows: Array<{ status: string; occurred_at: string }> = []
  return {
    getQueryRows: () => rows,
    setQueryRows: (r: Array<{ status: string; occurred_at: string }>) => {
      rows = r
    },
    notificationsInsert: vi.fn().mockResolvedValue({ error: null }),
  }
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'outbound_notifications') return { insert: notificationsInsert }
      // agent_events query chain
      return {
        select: () => ({
          eq: () => ({
            gte: () => ({
              order: () => Promise.resolve({ data: getQueryRows(), error: null }),
            }),
          }),
        }),
      }
    },
  })),
}))

vi.mock('@/lib/knowledge/client', () => ({
  logEvent: vi.fn().mockResolvedValue('mock-event-id'),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import { getCircuitState } from '@/lib/ollama/circuit'
import { generate, OllamaUnreachableError } from '@/lib/ollama/client'
import { logEvent } from '@/lib/knowledge/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFailureRows(count: number, minutesAgo: number) {
  const base = Date.now() - minutesAgo * 60 * 1000
  return Array.from({ length: count }, (_, i) => ({
    status: 'failure',
    occurred_at: new Date(base + i * 1000).toISOString(),
  }))
}

function wireSupabase(rows: Array<{ status: string; occurred_at: string }>) {
  setQueryRows(rows)
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  setQueryRows([])
  delete process.env.OLLAMA_TUNNEL_URL
  delete process.env.OLLAMA_GENERAL_MODEL
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Test 1: 0 failures → CLOSED ───────────────────────────────────────────────

describe('getCircuitState — 0 failures → CLOSED', () => {
  it('returns CLOSED when no failures in last 30 minutes', async () => {
    wireSupabase([{ status: 'success', occurred_at: new Date().toISOString() }])

    const state = await getCircuitState()

    expect(state.state).toBe('CLOSED')
    expect(state.recent_failures).toBe(0)
    expect(state.open_reason).toBeNull()
  })
})

// ── Test 2: 3 recent failures → OPEN ─────────────────────────────────────────

describe('getCircuitState — 3 failures in last 5 min → OPEN', () => {
  it('returns OPEN with recent_failures=3', async () => {
    wireSupabase(makeFailureRows(3, 2))

    const state = await getCircuitState()

    expect(state.state).toBe('OPEN')
    expect(state.recent_failures).toBe(3)
    expect(state.last_failure_at).not.toBeNull()
  })
})

// ── Test 3: 3 failures but last one >5 min ago → HALF_OPEN ───────────────────

describe('getCircuitState — 3 failures but last >5 min ago → HALF_OPEN', () => {
  it('returns HALF_OPEN', async () => {
    wireSupabase(makeFailureRows(3, 10))

    const state = await getCircuitState()

    expect(state.state).toBe('HALF_OPEN')
    expect(state.recent_failures).toBe(0)
  })
})

// ── Test 4: generate() when circuit OPEN → throws + completes in <100ms ──────

describe('generate() when circuit OPEN → short-circuits fast', () => {
  it('throws OllamaUnreachableError in under 100ms and logs circuit_skip', async () => {
    wireSupabase(makeFailureRows(3, 2))

    const slowFetch = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('should not be called')), 3_000)
          )
      )
    vi.stubGlobal('fetch', slowFetch)

    const start = Date.now()
    await expect(generate('test prompt')).rejects.toThrow(OllamaUnreachableError)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(100)

    expect(logEvent).toHaveBeenCalledWith(
      'ollama',
      'ollama.circuit_skip',
      expect.objectContaining({
        meta: expect.objectContaining({ reason: 'circuit_open' }),
      })
    )

    const generateCalls = (slowFetch.mock.calls as unknown[][]).filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('/api/generate')
    )
    expect(generateCalls).toHaveLength(0)
  }, 10_000)
})

// ── Test 5: HALF_OPEN probe succeeds → proceeds to generate ──────────────────

describe('generate() when circuit HALF_OPEN → probes healthCheck, then generates', () => {
  it('calls healthCheck first, then generates on success', async () => {
    wireSupabase(makeFailureRows(3, 10))

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ models: [{ name: 'qwen2.5:7b' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          response: 'answer',
          prompt_eval_count: 5,
          eval_count: 10,
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generate('test prompt', { model: 'qwen2.5:7b' })

    expect(result.text).toBe('answer')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// ── Test 6: CLOSED→OPEN transition inserts outbound_notifications row ─────────

describe('circuit CLOSED→OPEN transition → outbound_notifications insert', () => {
  it('inserts a telegram notification when circuit opens', async () => {
    // Establish CLOSED state in module
    wireSupabase([])
    await getCircuitState()

    // Switch to OPEN
    wireSupabase(makeFailureRows(3, 2))

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('not called')))

    await expect(generate('test')).rejects.toThrow(OllamaUnreachableError)

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(notificationsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'telegram',
        requires_response: false,
        correlation_id: 'ollama_circuit_open',
      })
    )
  })
})

// ── Test 7: failure events include meta.model and meta.error ──────────────────

describe('generate() failure events include meta.model and meta.error', () => {
  it('logs meta with model and error on network failure', async () => {
    wireSupabase([])

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    await expect(generate('test')).rejects.toThrow(OllamaUnreachableError)

    expect(logEvent).toHaveBeenCalledWith(
      'ollama',
      'ollama.generate',
      expect.objectContaining({
        status: 'failure',
        meta: expect.objectContaining({
          model: expect.any(String),
          error: expect.any(String),
        }),
      })
    )
  })
})

// ── Test 8: getBaseUrl() in production with localhost → warning logged once ───
// Note: tests the module-level _startupWarned guard. Uses the already-mocked
// logEvent (hoisted at top of file). Just verify the warning fires once.

describe('getBaseUrl() startup warning', () => {
  it('logs ollama.config_warning once when NODE_ENV=production and URL is localhost', async () => {
    // Stub production env — OLLAMA_TUNNEL_URL not set so localhost is used
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.OLLAMA_TUNNEL_URL

    // Import the real getBaseUrl (already mocked dependencies above)
    // We need a fresh _startupWarned — use resetModules then re-import
    vi.resetModules()

    // After resetModules, re-import with fresh module state
    // The top-level vi.mock for @/lib/knowledge/client is still in effect
    const { getBaseUrl: getBaseUrlFresh } = await import('@/lib/ollama/client')
    const { logEvent: logEventFresh } = await import('@/lib/knowledge/client')

    // Call twice — _startupWarned should prevent second log
    getBaseUrlFresh()
    getBaseUrlFresh()

    // Wait for fire-and-forget
    await new Promise((resolve) => setTimeout(resolve, 30))

    const warningCalls = (logEventFresh as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[1] === 'ollama.config_warning'
    )
    expect(warningCalls).toHaveLength(1)
  })
})
