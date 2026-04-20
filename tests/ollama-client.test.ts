/**
 * Unit tests for lib/ollama/client.ts
 *
 * All Ollama HTTP calls are mocked via vi.stubGlobal('fetch', ...).
 * agent_events logging is mocked via @/lib/knowledge/client.
 * No real HTTP or Supabase connections are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock knowledge/client (logEvent is fire-and-forget) ───────────────────────

vi.mock('@/lib/knowledge/client', () => ({
  logEvent: vi.fn().mockResolvedValue('mock-event-id'),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  healthCheck,
  generate,
  embed,
  autoSelectModel,
  extractConfidence,
  OllamaUnreachableError,
  getBaseUrl,
} from '@/lib/ollama/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(response: unknown, status = 200, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(response),
  })
}

function mockFetchReject(err: Error) {
  return vi.fn().mockRejectedValue(err)
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // Clear any env overrides between tests
  delete process.env.OLLAMA_TUNNEL_URL
  delete process.env.OLLAMA_CODE_MODEL
  delete process.env.OLLAMA_EMBED_MODEL
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── getBaseUrl ────────────────────────────────────────────────────────────────

describe('getBaseUrl', () => {
  it('defaults to localhost:11434', () => {
    expect(getBaseUrl()).toBe('http://localhost:11434')
  })

  it('uses OLLAMA_TUNNEL_URL when set', () => {
    process.env.OLLAMA_TUNNEL_URL = 'https://my-tunnel.example.com'
    expect(getBaseUrl()).toBe('https://my-tunnel.example.com')
  })

  it('strips trailing slash from OLLAMA_TUNNEL_URL', () => {
    process.env.OLLAMA_TUNNEL_URL = 'https://my-tunnel.example.com/'
    expect(getBaseUrl()).toBe('https://my-tunnel.example.com')
  })
})

// ── autoSelectModel ───────────────────────────────────────────────────────────

describe('autoSelectModel', () => {
  it('returns qwen2.5-coder:7b for code tasks by default', () => {
    expect(autoSelectModel('code')).toBe('qwen2.5-coder:7b')
  })

  it('returns qwen2.5:32b for analysis tasks by default', () => {
    expect(autoSelectModel('analysis')).toBe('qwen2.5:32b')
  })

  it('returns qwen2.5:7b for general tasks by default', () => {
    expect(autoSelectModel('general')).toBe('qwen2.5:7b')
  })

  it('returns nomic-embed-text for embed tasks by default', () => {
    expect(autoSelectModel('embed')).toBe('nomic-embed-text')
  })

  it('respects OLLAMA_CODE_MODEL override', () => {
    process.env.OLLAMA_CODE_MODEL = 'qwen2.5-coder:32b'
    expect(autoSelectModel('code')).toBe('qwen2.5-coder:32b')
  })

  it('respects OLLAMA_EMBED_MODEL override', () => {
    process.env.OLLAMA_EMBED_MODEL = 'mxbai-embed-large'
    expect(autoSelectModel('embed')).toBe('mxbai-embed-large')
  })
})

// ── extractConfidence ─────────────────────────────────────────────────────────

describe('extractConfidence', () => {
  it('returns 0.85 for confident text (no hedging)', () => {
    expect(extractConfidence('The answer is 42. This is correct.')).toBe(0.85)
  })

  it('returns 0.60 for one uncertainty phrase', () => {
    expect(extractConfidence("I think the answer is 42.")).toBe(0.60)
  })

  it('returns 0.40 for two uncertainty phrases', () => {
    expect(extractConfidence("I think maybe the answer is 42.")).toBe(0.40)
  })

  it('returns 0.20 for three or more uncertainty phrases', () => {
    expect(extractConfidence("I'm not sure, maybe possibly this is right.")).toBe(0.20)
  })

  it('is case-insensitive (detects uppercase uncertainty phrase)', () => {
    // "PERHAPS" → "perhaps" after lowercase → 1 match → 0.60
    // ("perhaps" has no overlapping sub-phrases in the list)
    expect(extractConfidence('PERHAPS this is correct.')).toBe(0.60)
  })

  it('returns 0.85 for empty string', () => {
    expect(extractConfidence('')).toBe(0.85)
  })
})

// ── healthCheck ───────────────────────────────────────────────────────────────

describe('healthCheck', () => {
  it('returns reachable=true with model list on success', async () => {
    vi.stubGlobal('fetch', mockFetch({
      models: [{ name: 'qwen2.5:7b' }, { name: 'nomic-embed-text' }],
    }))

    const result = await healthCheck()

    expect(result.reachable).toBe(true)
    expect(result.models).toEqual(['qwen2.5:7b', 'nomic-embed-text'])
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
    expect(result.tunnel_used).toBe(false)
  })

  it('returns reachable=false when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', mockFetchReject(new Error('ECONNREFUSED')))

    const result = await healthCheck()

    expect(result.reachable).toBe(false)
    expect(result.models).toEqual([])
  })

  it('returns reachable=false when HTTP status is non-ok', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 503, false))

    const result = await healthCheck()

    expect(result.reachable).toBe(false)
  })

  it('sets tunnel_used=true when OLLAMA_TUNNEL_URL is set and different from localhost', async () => {
    process.env.OLLAMA_TUNNEL_URL = 'https://tunnel.example.com'
    vi.stubGlobal('fetch', mockFetch({ models: [] }))

    const result = await healthCheck()

    expect(result.tunnel_used).toBe(true)
  })

  it('handles missing models field gracefully', async () => {
    vi.stubGlobal('fetch', mockFetch({}))

    const result = await healthCheck()

    expect(result.reachable).toBe(true)
    expect(result.models).toEqual([])
  })
})

// ── generate ──────────────────────────────────────────────────────────────────

describe('generate', () => {
  it('returns text and confidence on success', async () => {
    vi.stubGlobal('fetch', mockFetch({
      response: 'The SP-API rate limit is 1 request per second.',
      prompt_eval_count: 10,
      eval_count: 20,
    }))

    const result = await generate('What is the SP-API rate limit?')

    expect(result.text).toBe('The SP-API rate limit is 1 request per second.')
    expect(result.confidence).toBe(0.85)
    expect(result.tokens_used).toBe(30)
    expect(result.model).toBe('qwen2.5:7b')
  })

  it('returns low confidence when response contains uncertainty phrases', async () => {
    vi.stubGlobal('fetch', mockFetch({
      response: "I'm not sure, but maybe it's 1 request per second.",
    }))

    const result = await generate('What is the SP-API rate limit?')

    expect(result.confidence).toBeLessThan(0.61)
  })

  it('uses task-appropriate model', async () => {
    vi.stubGlobal('fetch', mockFetch({ response: 'code output' }))

    const result = await generate('Write a function', { task: 'code' })

    expect(result.model).toBe('qwen2.5-coder:7b')
  })

  it('throws OllamaUnreachableError when fetch fails', async () => {
    vi.stubGlobal('fetch', mockFetchReject(new Error('ECONNREFUSED')))

    await expect(generate('test prompt')).rejects.toThrow(OllamaUnreachableError)
  })

  it('throws OllamaUnreachableError on non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 500, false))

    await expect(generate('test')).rejects.toThrow(OllamaUnreachableError)
  })

  it('handles missing token counts (null tokens_used)', async () => {
    vi.stubGlobal('fetch', mockFetch({ response: 'answer' }))

    const result = await generate('test')

    expect(result.tokens_used).toBeNull()
  })
})

// ── embed ─────────────────────────────────────────────────────────────────────

describe('embed', () => {
  it('returns a number array on success', async () => {
    const fakeEmbedding = Array.from({ length: 768 }, (_, i) => i * 0.001)
    vi.stubGlobal('fetch', mockFetch({ embedding: fakeEmbedding }))

    const result = await embed('Keepa token exhaustion')

    expect(result).toHaveLength(768)
    expect(typeof result[0]).toBe('number')
  })

  it('throws OllamaUnreachableError when fetch fails', async () => {
    vi.stubGlobal('fetch', mockFetchReject(new Error('timeout')))

    await expect(embed('test text')).rejects.toThrow(OllamaUnreachableError)
  })

  it('throws OllamaUnreachableError on non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 404, false))

    await expect(embed('test')).rejects.toThrow(OllamaUnreachableError)
  })

  it('uses the embed model (nomic-embed-text by default)', async () => {
    const fakeFetch = mockFetch({ embedding: new Array(768).fill(0) })
    vi.stubGlobal('fetch', fakeFetch)

    await embed('test')

    const body = JSON.parse(fakeFetch.mock.calls[0][1].body as string)
    expect(body.model).toBe('nomic-embed-text')
  })
})
