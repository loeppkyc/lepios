/**
 * Unit tests for buildChatUiDigestLine.
 * Covers: no data, tool calls only, denials only, both, DB error fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { buildChatUiDigestLine } from '@/lib/orb/tools/chat-ui-digest'

function makeCountBuilder(count: number | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue({ count, error: null }),
  }
}

function makeErrorBuilder() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue({ count: null, error: new Error('db error') }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildChatUiDigestLine', () => {
  it('returns no-tool-calls line when both counts are 0', async () => {
    mockFrom
      .mockReturnValueOnce(makeCountBuilder(0)) // agent_events
      .mockReturnValueOnce(makeCountBuilder(0)) // agent_actions
    const line = await buildChatUiDigestLine()
    expect(line).toBe('Chat UI (24h): no tool calls')
  })

  it('returns counts when there are tool calls and no denies', async () => {
    mockFrom
      .mockReturnValueOnce(makeCountBuilder(7))
      .mockReturnValueOnce(makeCountBuilder(0))
    const line = await buildChatUiDigestLine()
    expect(line).toBe('Chat UI (24h): 7 tool calls, 0 denies')
  })

  it('returns counts when there are both tool calls and denies', async () => {
    mockFrom
      .mockReturnValueOnce(makeCountBuilder(12))
      .mockReturnValueOnce(makeCountBuilder(3))
    const line = await buildChatUiDigestLine()
    expect(line).toBe('Chat UI (24h): 12 tool calls, 3 denies')
  })

  it('treats null count as 0', async () => {
    mockFrom
      .mockReturnValueOnce(makeCountBuilder(null))
      .mockReturnValueOnce(makeCountBuilder(null))
    const line = await buildChatUiDigestLine()
    expect(line).toBe('Chat UI (24h): no tool calls')
  })

  it('returns unavailable on DB error without throwing', async () => {
    mockFrom.mockReturnValueOnce(makeErrorBuilder())
    const line = await buildChatUiDigestLine()
    expect(line).toBe('Chat UI: stats unavailable')
  })
})
