/**
 * Unit tests for listIdeasTool.
 * Covers: tool metadata, default status filter, all-status, empty result, DB error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { listIdeasTool } from '@/lib/orb/tools/list-ideas'

const sampleIdea = {
  id: 'idea-1',
  title: 'Great idea',
  summary: 'Short summary',
  status: 'active',
  score: 0.9,
  source: 'manual_api',
  tags: ['twin'],
  created_at: '2026-05-03T10:00:00Z',
}

function makeQueryBuilder(rows: unknown[], error: Error | null = null) {
  return {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: rows, error }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listIdeasTool metadata', () => {
  it('has correct name and capability', () => {
    expect(listIdeasTool.name).toBe('listIdeas')
    expect(listIdeasTool.capability).toBe('tool.chat_ui.read.idea_inbox')
  })
})

describe('listIdeasTool execute', () => {
  it('returns ideas and count with default params', async () => {
    mockFrom.mockReturnValueOnce(makeQueryBuilder([sampleIdea]))

    const result = await listIdeasTool.execute({}, {} as never)
    expect(result.count).toBe(1)
    expect(result.ideas[0].title).toBe('Great idea')
  })

  it('returns empty array when no ideas match', async () => {
    mockFrom.mockReturnValueOnce(makeQueryBuilder([]))

    const result = await listIdeasTool.execute({ status: 'shipped' }, {} as never)
    expect(result.count).toBe(0)
    expect(result.ideas).toHaveLength(0)
  })

  it('applies no status filter when status is "all"', async () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [sampleIdea], error: null }),
      eq: vi.fn(),
    }
    mockFrom.mockReturnValueOnce(builder)

    const result = await listIdeasTool.execute({ status: 'all' }, {} as never)
    expect(result.count).toBe(1)
    expect(builder.eq).not.toHaveBeenCalled()
  })

  it('throws on DB error', async () => {
    mockFrom.mockReturnValueOnce(makeQueryBuilder([], new Error('timeout')))

    await expect(listIdeasTool.execute({}, {} as never)).rejects.toThrow('timeout')
  })
})
