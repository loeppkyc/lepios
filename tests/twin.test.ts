/**
 * Tests for /api/twin/ask route and lib/twin/uncertainty.ts
 *
 * All external calls (Ollama, Supabase, Anthropic) are mocked.
 * No real network or DB connections are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isUncertain } from '@/lib/twin/uncertainty'

// ── Hoisted mock handles ──────────────────────────────────────────────────────

const {
  mockEmbed,
  mockGenerate,
  MockOllamaUnreachableError,
  mockRpc,
  mockFrom,
  mockLogEvent,
  mockClaudeCreate,
} = vi.hoisted(() => {
  class MockOllamaUnreachableError extends Error {
    override readonly name = 'OllamaUnreachableError'
    constructor(cause?: unknown) {
      super('Ollama is unreachable')
      void cause
    }
  }
  return {
    mockEmbed: vi.fn(),
    mockGenerate: vi.fn(),
    MockOllamaUnreachableError,
    mockRpc: vi.fn(),
    mockFrom: vi.fn(),
    mockLogEvent: vi.fn().mockResolvedValue('mock-event-id'),
    mockClaudeCreate: vi.fn(),
  }
})

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/ollama/client', () => ({
  embed: mockEmbed,
  generate: mockGenerate,
  OllamaUnreachableError: MockOllamaUnreachableError,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ rpc: mockRpc, from: mockFrom })),
}))

vi.mock('@/lib/knowledge/client', () => ({
  logEvent: mockLogEvent,
}))

vi.mock('@anthropic-ai/sdk', () => ({
  // Use a class so `new Anthropic(...)` works without Vitest constructor warnings
  default: class {
    messages = { create: mockClaudeCreate }
  },
}))

// ── Import route handler after mocks ─────────────────────────────────────────

import { POST } from '@/app/api/twin/ask/route'
import { NextRequest } from 'next/server'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_EMBEDDING = new Array(768).fill(0.1)

function makePersonalChunk(
  overrides: Partial<{
    id: string
    category: string
    title: string
    problem: string | null
    solution: string | null
    context: string | null
    similarity: number
  }> = {}
) {
  return {
    id: 'chunk-abc',
    category: 'personal_correspondence',
    title: 'Colin on moving abroad',
    problem: null,
    solution: null,
    context: 'Colin prefers living in Alberta.',
    similarity: 0.75,
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/twin/ask', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function makeFtsChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'textSearch', 'in', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

function makeFtsChunk(
  overrides: Partial<{
    id: string
    category: string
    title: string
    problem: string | null
    solution: string | null
    context: string | null
  }> = {}
) {
  return {
    id: 'fts-chunk-xyz',
    category: 'personal_correspondence',
    title: 'Colin on living in Alberta',
    problem: null,
    solution: null,
    context: 'Colin prefers living in Alberta.',
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.OLLAMA_TWIN_MODEL
  delete process.env.TWIN_CONFIDENCE_THRESHOLD
  mockFrom.mockReturnValue(makeFtsChain({ data: [], error: null }))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── isUncertain (3e) ──────────────────────────────────────────────────────────

describe('isUncertain', () => {
  it('returns true for "i cannot" (Streamlit verbatim marker)', () => {
    expect(isUncertain('i cannot answer that question.')).toBe(true)
  })

  it('returns true for "i\'m not sure" (Streamlit verbatim marker)', () => {
    expect(isUncertain("I'm not sure about this.")).toBe(true)
  })

  it('returns true for "context doesn\'t contain" (verbatim)', () => {
    expect(isUncertain("The context doesn't contain that information.")).toBe(true)
  })

  it('returns true for "no data available" (verbatim)', () => {
    expect(isUncertain('No data available for that query.')).toBe(true)
  })

  it('returns false for a confident factual answer', () => {
    expect(isUncertain('Colin lives in Edmonton, Alberta.')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isUncertain("I DON'T KNOW the answer.")).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isUncertain('')).toBe(false)
  })
})

// ── /api/twin/ask ─────────────────────────────────────────────────────────────

describe('POST /api/twin/ask', () => {
  it('returns 400 when question is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/question/i)
  })

  it('factual Q with matching corpus → high confidence, no escalate', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk({ similarity: 0.75 })], error: null })
    mockGenerate.mockResolvedValue({
      text: 'Colin lives in Edmonton and has no plans to move.',
      confidence: 0.85,
      model: 'qwen2.5:32b',
      tokens_used: 40,
    })

    const res = await POST(makeRequest({ question: 'Where does Colin live?' }))
    const body = (await res.json()) as {
      answer: string
      confidence: number
      escalate: boolean
      sources: unknown[]
    }

    expect(res.status).toBe(200)
    expect(body.escalate).toBe(false)
    expect(body.confidence).toBeGreaterThanOrEqual(0.8)
    expect(body.sources).toHaveLength(1)
    expect(body.answer).toContain('Edmonton')
  })

  it('Q with no matching personal chunks → escalate=true, reason=insufficient_context', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    // RPC returns only non-personal chunks — filter removes them
    mockRpc.mockResolvedValue({
      data: [makePersonalChunk({ category: 'error_fix', similarity: 0.8 })],
      error: null,
    })
    mockGenerate.mockResolvedValue({
      text: 'insufficient_context',
      confidence: 0,
      model: 'qwen2.5:32b',
      tokens_used: 5,
    })

    const res = await POST(makeRequest({ question: "What is Colin's credit score?" }))
    const body = (await res.json()) as { escalate: boolean; escalate_reason: string }

    expect(body.escalate).toBe(true)
    expect(body.escalate_reason).toBe('insufficient_context')
  })

  it('Q about personal values → escalate=true, reason=personal_escalation (never answered)', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk()], error: null })
    mockGenerate.mockResolvedValue({
      text: 'personal_escalation',
      confidence: 0,
      model: 'qwen2.5:32b',
      tokens_used: 5,
    })

    const res = await POST(makeRequest({ question: 'Should Colin move to the USA?' }))
    const body = (await res.json()) as {
      escalate: boolean
      escalate_reason: string
      answer: string
    }

    expect(body.escalate).toBe(true)
    expect(body.escalate_reason).toBe('personal_escalation')
    // personal_escalation: the raw token is returned as-is, never a fabricated answer
    expect(body.answer).toBe('personal_escalation')
  })

  it('marginal similarity → below threshold → Claude fallback triggers', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    // similarity 0.5 → computeConfidence returns 0.70 < 0.80 threshold
    mockRpc.mockResolvedValue({ data: [makePersonalChunk({ similarity: 0.5 })], error: null })
    mockGenerate.mockResolvedValue({
      text: 'Colin might have mentioned something about this.',
      confidence: 0.7,
      model: 'qwen2.5:32b',
      tokens_used: 20,
    })
    mockClaudeCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Based on the context, Colin prefers Alberta.' }],
    })

    const res = await POST(makeRequest({ question: 'Where does Colin prefer to live?' }))
    const body = (await res.json()) as {
      escalate: boolean
      escalate_reason: string | null
      confidence: number
      answer: string
    }

    // Claude returns 0.75 confidence — still below 0.80 → escalates with 'below_threshold'
    expect(body.escalate).toBe(true)
    expect(body.escalate_reason).toBe('below_threshold')
    expect(body.answer).toContain('Alberta')
    expect(mockClaudeCreate).toHaveBeenCalledOnce()
  })

  it('env var trim: OLLAMA_TWIN_MODEL with trailing \\r\\n is trimmed before use', async () => {
    process.env.OLLAMA_TWIN_MODEL = 'qwen2.5:32b\r\n'
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk({ similarity: 0.75 })], error: null })
    mockGenerate.mockResolvedValue({
      text: 'Colin lives in Edmonton.',
      confidence: 0.85,
      model: 'qwen2.5:32b',
      tokens_used: 10,
    })

    await POST(makeRequest({ question: 'Where does Colin live?' }))

    // generate() should have been called with the trimmed model name
    const callArgs = mockGenerate.mock.calls[0][1] as { model: string }
    expect(callArgs.model).toBe('qwen2.5:32b')
    expect(callArgs.model).not.toContain('\r')
    expect(callArgs.model).not.toContain('\n')
  })

  it('Ollama unreachable + context available → Claude fallback fires, no throw', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk({ similarity: 0.75 })], error: null })
    mockGenerate.mockRejectedValue(new MockOllamaUnreachableError())
    mockClaudeCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Colin lives in Edmonton.' }],
    })

    const res = await POST(makeRequest({ question: 'Where does Colin live?' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { answer: string }
    expect(body.answer).toContain('Edmonton')
    expect(mockClaudeCreate).toHaveBeenCalledOnce()
  })
})

// ── FTS fallback path (Phase 3) ───────────────────────────────────────────────

describe('POST /api/twin/ask — FTS fallback', () => {
  it('embed fails → FTS fallback runs → retrieval_path is fts', async () => {
    vi.stubEnv('TWIN_CONFIDENCE_THRESHOLD', '0.40')
    mockEmbed.mockRejectedValue(new Error('embed unavailable'))
    mockFrom.mockReturnValue(makeFtsChain({ data: [makeFtsChunk()], error: null }))
    mockGenerate.mockResolvedValue({
      text: 'Colin lives in Alberta.',
      confidence: 0.85,
      model: 'qwen2.5:32b',
      tokens_used: 20,
    })

    const res = await POST(makeRequest({ question: 'Where does Colin live?' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { retrieval_path: string; sources: { similarity: number }[] }
    expect(body.retrieval_path).toBe('fts')
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0].similarity).toBe(0)
  })

  it('embed succeeds → vector path used → retrieval_path is vector, FTS not called', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk({ similarity: 0.75 })], error: null })
    mockGenerate.mockResolvedValue({
      text: 'Colin lives in Edmonton.',
      confidence: 0.85,
      model: 'qwen2.5:32b',
      tokens_used: 20,
    })

    const res = await POST(makeRequest({ question: 'Where does Colin live?' }))
    const body = (await res.json()) as { retrieval_path: string }
    expect(body.retrieval_path).toBe('vector')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('embed fails + FTS empty → retrieval_path none, escalates', async () => {
    mockEmbed.mockRejectedValue(new Error('embed unavailable'))
    // default mockFrom returns empty FTS chain
    mockGenerate.mockResolvedValue({
      text: 'insufficient_context',
      confidence: 0,
      model: 'qwen2.5:32b',
      tokens_used: 5,
    })

    const res = await POST(makeRequest({ question: "What is Colin's credit score?" }))
    const body = (await res.json()) as {
      retrieval_path: string
      escalate: boolean
      sources: unknown[]
    }
    expect(res.status).toBe(200)
    expect(body.retrieval_path).toBe('none')
    expect(body.escalate).toBe(true)
    expect(body.sources).toHaveLength(0)
  })

  it('embed fails + FTS DB error → retrieval_path none, never throws', async () => {
    mockEmbed.mockRejectedValue(new Error('embed unavailable'))
    mockFrom.mockReturnValue(makeFtsChain({ data: null, error: { message: 'DB error' } }))
    mockGenerate.mockResolvedValue({
      text: 'insufficient_context',
      confidence: 0,
      model: 'qwen2.5:32b',
      tokens_used: 5,
    })

    const res = await POST(makeRequest({ question: 'test?' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { retrieval_path: string }
    expect(body.retrieval_path).toBe('none')
  })
})
