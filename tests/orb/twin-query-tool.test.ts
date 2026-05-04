/**
 * Tests for lib/orb/tools/twin-query.ts (twinQueryTool).
 *
 * Mocks askTwin from @/lib/twin/query.
 * No real network or DB connections are made.
 *
 * Spec: docs/harness/CHAT_UI_SPEC.md §AD5.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAskTwin } = vi.hoisted(() => ({
  mockAskTwin: vi.fn(),
}))

vi.mock('@/lib/twin/query', () => ({
  askTwin: mockAskTwin,
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { twinQueryTool } from '@/lib/orb/tools/twin-query'
import type { TwinResponse } from '@/lib/twin/query'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTwinResponse(overrides: Partial<TwinResponse> = {}): TwinResponse {
  return {
    answer: 'Colin prefers living in Alberta.',
    confidence: 0.85,
    sources: [{ chunk_id: 'chunk-abc', similarity: 0.75 }],
    escalate: false,
    escalate_reason: null,
    retrieval_path: 'vector',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Shape tests ───────────────────────────────────────────────────────────────

describe('twinQueryTool — metadata', () => {
  it('has name queryTwin', () => {
    expect(twinQueryTool.name).toBe('queryTwin')
  })

  it('has capability tool.chat_ui.read.twin', () => {
    expect(twinQueryTool.capability).toBe('tool.chat_ui.read.twin')
  })

  it('description mentions personal knowledge corpus', () => {
    expect(twinQueryTool.description).toMatch(/personal knowledge corpus/i)
  })
})

// ── execute: structured output ────────────────────────────────────────────────

describe('twinQueryTool.execute — structured output', () => {
  it('returns answer/confidence/escalate/retrieval_path/sources_count', async () => {
    mockAskTwin.mockResolvedValue(makeTwinResponse())

    const result = await twinQueryTool.execute({ question: 'Where does Colin live?' })

    expect(result.answer).toBe('Colin prefers living in Alberta.')
    expect(result.confidence).toBe(0.85)
    expect(result.escalate).toBe(false)
    expect(result.escalate_reason).toBeNull()
    expect(result.retrieval_path).toBe('vector')
    expect(result.sources_count).toBe(1)
  })

  it('passes question to askTwin', async () => {
    mockAskTwin.mockResolvedValue(makeTwinResponse())

    await twinQueryTool.execute({ question: 'What is my view on crypto?' })

    expect(mockAskTwin).toHaveBeenCalledWith('What is my view on crypto?')
  })
})

// ── execute: escalate=true path ───────────────────────────────────────────────

describe('twinQueryTool.execute — escalate path', () => {
  it('returns escalate=true when twin returns escalate=true', async () => {
    mockAskTwin.mockResolvedValue(
      makeTwinResponse({
        answer: '',
        confidence: 0,
        escalate: true,
        escalate_reason: 'insufficient_context',
        retrieval_path: 'none',
        sources: [],
      }),
    )

    const result = await twinQueryTool.execute({ question: 'What is my bank account number?' })

    expect(result.escalate).toBe(true)
    expect(result.escalate_reason).toBe('insufficient_context')
    expect(result.sources_count).toBe(0)
  })

  it('returns escalate=true with personal_escalation reason', async () => {
    mockAskTwin.mockResolvedValue(
      makeTwinResponse({
        answer: 'personal_escalation',
        confidence: 0,
        escalate: true,
        escalate_reason: 'personal_escalation',
        retrieval_path: 'vector',
        sources: [{ chunk_id: 'chunk-xyz', similarity: 0.8 }],
      }),
    )

    const result = await twinQueryTool.execute({ question: 'Should Colin move to the USA?' })

    expect(result.escalate).toBe(true)
    expect(result.escalate_reason).toBe('personal_escalation')
  })

  it('returns escalate=true with below_threshold reason', async () => {
    mockAskTwin.mockResolvedValue(
      makeTwinResponse({
        answer: 'Something vague.',
        confidence: 0.45,
        escalate: true,
        escalate_reason: 'below_threshold',
        retrieval_path: 'fts',
        sources: [{ chunk_id: 'fts-chunk', similarity: 0 }],
      }),
    )

    const result = await twinQueryTool.execute({ question: 'Tell me about Colin?' })

    expect(result.escalate).toBe(true)
    expect(result.escalate_reason).toBe('below_threshold')
    expect(result.retrieval_path).toBe('fts')
  })
})

// ── execute: sources_count ────────────────────────────────────────────────────

describe('twinQueryTool.execute — sources_count', () => {
  it('sources_count reflects number of sources returned', async () => {
    mockAskTwin.mockResolvedValue(
      makeTwinResponse({
        sources: [
          { chunk_id: 'c1', similarity: 0.9 },
          { chunk_id: 'c2', similarity: 0.8 },
          { chunk_id: 'c3', similarity: 0.7 },
        ],
      }),
    )

    const result = await twinQueryTool.execute({ question: 'What are Colin\'s principles?' })

    expect(result.sources_count).toBe(3)
  })

  it('sources_count is 0 when no sources', async () => {
    mockAskTwin.mockResolvedValue(
      makeTwinResponse({ sources: [], escalate: true, escalate_reason: 'insufficient_context' }),
    )

    const result = await twinQueryTool.execute({ question: 'Unknown question?' })

    expect(result.sources_count).toBe(0)
  })
})
