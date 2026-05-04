/**
 * C4 — chat→Twin summarization check tests.
 *
 * Verifies:
 *   (a) conversations updated in 24h window are processed
 *   (b) conversations with no messages are skipped
 *   (c) facts starting with "Colin " are saved to knowledge
 *   (d) Ollama unavailable → warn flag, status still ok, no throw
 *   (e) DB error → fail status, no throw
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAskOllama, mockSaveKnowledge, mockDbQuery } = vi.hoisted(() => ({
  mockAskOllama: vi.fn(),
  mockSaveKnowledge: vi.fn().mockResolvedValue('knowledge-id'),
  mockDbQuery: vi.fn(),
}))

vi.mock('@/lib/llm/ollama', () => ({
  askOllama: mockAskOllama,
}))

vi.mock('@/lib/knowledge/client', () => ({
  saveKnowledge: mockSaveKnowledge,
}))

// Supabase mock: configurable per-test via mockDbQuery
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(() => mockDbQuery(table)),
    })),
  })),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import { checkChatSummarize } from '@/lib/orchestrator/checks/chat-summarize'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONV_A = { id: 'conv-a', title: 'Planning session' }
const MSG_USER = { role: 'user', content: [{ type: 'text', text: 'I prefer async over sync patterns.' }] }
const MSG_ASST = { role: 'assistant', content: [{ type: 'text', text: 'Understood.' }] }

function makeOllamaResult(text: string) {
  return { text, confidence: 0.8, sycophancy_flag: false, latency_ms: 100, model: 'qwen2.5:32b' }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks())

describe('checkChatSummarize — (a) normal path', () => {
  it('processes conversations and saves extracted facts', async () => {
    mockDbQuery.mockImplementation((table: string) => {
      if (table === 'conversations') return Promise.resolve({ data: [CONV_A], error: null })
      if (table === 'messages') return Promise.resolve({ data: [MSG_USER, MSG_ASST], error: null })
      return Promise.resolve({ data: [], error: null })
    })
    mockAskOllama.mockResolvedValue(
      makeOllamaResult('Colin prefers async patterns.\nColin avoids synchronous code when possible.')
    )

    const result = await checkChatSummarize()

    expect(result.status).toBe('ok')
    expect(result.counts.conversations_scanned).toBe(1)
    expect(result.counts.facts_saved).toBe(2)
    expect(mockSaveKnowledge).toHaveBeenCalledTimes(2)
    expect(mockSaveKnowledge).toHaveBeenCalledWith(
      'principle',
      'chat_summary',
      expect.stringMatching(/^Colin /),
      expect.objectContaining({ tags: ['chat_derived'] })
    )
  })

  it('filters out lines that do not start with "Colin "', async () => {
    mockDbQuery.mockImplementation((table: string) => {
      if (table === 'conversations') return Promise.resolve({ data: [CONV_A], error: null })
      if (table === 'messages') return Promise.resolve({ data: [MSG_USER], error: null })
      return Promise.resolve({ data: [], error: null })
    })
    mockAskOllama.mockResolvedValue(
      makeOllamaResult('Colin likes async.\nSome other line.\n\nAnother random sentence.')
    )

    const result = await checkChatSummarize()
    expect(result.counts.facts_saved).toBe(1)
  })
})

describe('checkChatSummarize — (b) no conversations', () => {
  it('returns ok with zero counts when no conversations updated recently', async () => {
    mockDbQuery.mockResolvedValue({ data: [], error: null })

    const result = await checkChatSummarize()

    expect(result.status).toBe('ok')
    expect(result.counts.conversations_scanned).toBe(0)
    expect(result.counts.facts_saved).toBe(0)
    expect(mockAskOllama).not.toHaveBeenCalled()
    expect(mockSaveKnowledge).not.toHaveBeenCalled()
  })

  it('skips conversations with no messages', async () => {
    mockDbQuery.mockImplementation((table: string) => {
      if (table === 'conversations') return Promise.resolve({ data: [CONV_A], error: null })
      if (table === 'messages') return Promise.resolve({ data: [], error: null })
      return Promise.resolve({ data: [], error: null })
    })

    const result = await checkChatSummarize()
    expect(result.counts.conversations_scanned).toBe(1)
    expect(result.counts.facts_saved).toBe(0)
    expect(mockAskOllama).not.toHaveBeenCalled()
  })
})

describe('checkChatSummarize — (d) Ollama unavailable', () => {
  it('adds warn flag and returns ok status when Ollama returns null', async () => {
    mockDbQuery.mockImplementation((table: string) => {
      if (table === 'conversations') return Promise.resolve({ data: [CONV_A], error: null })
      if (table === 'messages') return Promise.resolve({ data: [MSG_USER], error: null })
      return Promise.resolve({ data: [], error: null })
    })
    mockAskOllama.mockResolvedValue(null)

    const result = await checkChatSummarize()

    expect(result.status).toBe('ok')
    expect(result.flags.some((f) => f.severity === 'warn')).toBe(true)
    expect(result.counts.facts_saved).toBe(0)
  })
})

describe('checkChatSummarize — (e) DB error', () => {
  it('returns fail status without throwing when conversations query errors', async () => {
    mockDbQuery.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } })

    const result = await checkChatSummarize()

    expect(result.status).toBe('fail')
    expect(result.flags[0].severity).toBe('critical')
    expect(result.flags[0].message).toContain('relation does not exist')
  })
})
