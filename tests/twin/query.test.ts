/**
 * Tests for lib/twin/query.ts — askTwin() extracted logic.
 *
 * All external calls (Ollama, Supabase, Anthropic) are mocked.
 * No real network or DB connections are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  default: class {
    messages = { create: mockClaudeCreate }
  },
}))

// ── Import askTwin after mocks ─────────────────────────────────────────────────

import { askTwin } from '@/lib/twin/query'
import type { TwinResponse } from '@/lib/twin/query'

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
  }> = {},
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

function makeFtsChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'textSearch', 'in', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
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

// ── TwinResponse shape ────────────────────────────────────────────────────────

describe('askTwin — TwinResponse shape', () => {
  it('returns all required fields on successful path', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk({ similarity: 0.75 })], error: null })
    mockGenerate.mockResolvedValue({
      text: 'Colin lives in Edmonton and has no plans to move.',
      confidence: 0.85,
      model: 'qwen2.5:32b',
      tokens_used: 40,
    })

    const result: TwinResponse = await askTwin('Where does Colin live?')

    expect(result).toHaveProperty('answer')
    expect(result).toHaveProperty('confidence')
    expect(result).toHaveProperty('sources')
    expect(result).toHaveProperty('escalate')
    expect(result).toHaveProperty('escalate_reason')
    expect(result).toHaveProperty('retrieval_path')
  })

  it('high similarity → escalate=false, confidence ≥ 0.8', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk({ similarity: 0.75 })], error: null })
    mockGenerate.mockResolvedValue({
      text: 'Colin lives in Edmonton.',
      confidence: 0.85,
      model: 'qwen2.5:32b',
      tokens_used: 20,
    })

    const result = await askTwin('Where does Colin live?')

    expect(result.escalate).toBe(false)
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
    expect(result.sources).toHaveLength(1)
    expect(result.answer).toContain('Edmonton')
  })

  it('retrieval_path is vector when embed succeeds', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk({ similarity: 0.75 })], error: null })
    mockGenerate.mockResolvedValue({
      text: 'Colin lives in Edmonton.',
      confidence: 0.85,
      model: 'qwen2.5:32b',
      tokens_used: 20,
    })

    const result = await askTwin('Where does Colin live?')

    expect(result.retrieval_path).toBe('vector')
  })
})

// ── Ollama fallback ───────────────────────────────────────────────────────────

describe('askTwin — Ollama fallback to Claude', () => {
  it('Ollama unreachable + context → Claude fallback fires, returns answer', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk({ similarity: 0.75 })], error: null })
    mockGenerate.mockRejectedValue(new MockOllamaUnreachableError())
    mockClaudeCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Colin lives in Edmonton.' }],
    })

    const result = await askTwin('Where does Colin live?')

    expect(result.answer).toContain('Edmonton')
    expect(mockClaudeCreate).toHaveBeenCalledOnce()
  })

  it('Ollama unreachable + no context → escalates with insufficient_context', async () => {
    // embed fails so no chunks retrieved, contextStr will be empty
    mockEmbed.mockRejectedValue(new Error('embed unavailable'))
    mockFrom.mockReturnValue(makeFtsChain({ data: [], error: null }))
    mockGenerate.mockRejectedValue(new MockOllamaUnreachableError())

    const result = await askTwin('What is my credit score?')

    expect(result.escalate).toBe(true)
    expect(result.escalate_reason).toBe('insufficient_context')
  })

  it('Ollama unreachable + Claude also fails → escalates with below_threshold', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk({ similarity: 0.75 })], error: null })
    mockGenerate.mockRejectedValue(new MockOllamaUnreachableError())
    mockClaudeCreate.mockRejectedValue(new Error('Claude API error'))

    const result = await askTwin('Where does Colin live?')

    expect(result.escalate).toBe(true)
    expect(result.escalate_reason).toBe('below_threshold')
  })
})

// ── special tokens ────────────────────────────────────────────────────────────

describe('askTwin — special token handling', () => {
  it('insufficient_context token → escalate=true, confidence=0', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk()], error: null })
    mockGenerate.mockResolvedValue({
      text: 'insufficient_context',
      confidence: 0,
      model: 'qwen2.5:32b',
      tokens_used: 5,
    })

    const result = await askTwin("What is Colin's credit score?")

    expect(result.escalate).toBe(true)
    expect(result.escalate_reason).toBe('insufficient_context')
    expect(result.confidence).toBe(0)
  })

  it('personal_escalation token → escalate=true, reason=personal_escalation', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)
    mockRpc.mockResolvedValue({ data: [makePersonalChunk()], error: null })
    mockGenerate.mockResolvedValue({
      text: 'personal_escalation',
      confidence: 0,
      model: 'qwen2.5:32b',
      tokens_used: 5,
    })

    const result = await askTwin('Should Colin move to the USA?')

    expect(result.escalate).toBe(true)
    expect(result.escalate_reason).toBe('personal_escalation')
  })
})

// ── FTS fallback ──────────────────────────────────────────────────────────────

describe('askTwin — FTS fallback', () => {
  it('embed fails → FTS retrieval_path', async () => {
    vi.stubEnv('TWIN_CONFIDENCE_THRESHOLD', '0.40')
    mockEmbed.mockRejectedValue(new Error('embed unavailable'))
    mockFrom.mockReturnValue(
      makeFtsChain({
        data: [
          {
            id: 'fts-chunk',
            category: 'personal_correspondence',
            title: 'Colin on living in Alberta',
            problem: null,
            solution: null,
            context: 'Colin prefers living in Alberta.',
          },
        ],
        error: null,
      }),
    )
    mockGenerate.mockResolvedValue({
      text: 'Colin lives in Alberta.',
      confidence: 0.85,
      model: 'qwen2.5:32b',
      tokens_used: 20,
    })

    const result = await askTwin('Where does Colin live?')

    expect(result.retrieval_path).toBe('fts')
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].similarity).toBe(0)
  })
})
