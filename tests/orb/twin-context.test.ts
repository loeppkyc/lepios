/**
 * Tests for lib/orb/twin-context.ts (getTwinContext).
 *
 * Mocks @/lib/twin/query (retrievePersonalChunks + buildContextString).
 * No real network or DB connections are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockRetrievePersonalChunks, mockBuildContextString } = vi.hoisted(() => ({
  mockRetrievePersonalChunks: vi.fn(),
  mockBuildContextString: vi.fn(),
}))

vi.mock('@/lib/twin/query', () => ({
  retrievePersonalChunks: mockRetrievePersonalChunks,
  buildContextString: mockBuildContextString,
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { getTwinContext } from '@/lib/orb/twin-context'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChunk(id: string, similarity: number) {
  return {
    id,
    category: 'personal_knowledge_base',
    title: `Chunk ${id}`,
    problem: null,
    solution: null,
    context: 'Some context.',
    similarity,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBuildContextString.mockReturnValue('formatted context output')
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getTwinContext — retrieval_path: none', () => {
  it('returns null when retrieval_path is none', async () => {
    mockRetrievePersonalChunks.mockResolvedValue({ chunks: [], retrieval_path: 'none' })

    const result = await getTwinContext('What is my budget?')

    expect(result).toBeNull()
  })
})

describe('getTwinContext — empty chunks', () => {
  it('returns null when chunks array is empty (vector path)', async () => {
    mockRetrievePersonalChunks.mockResolvedValue({ chunks: [], retrieval_path: 'vector' })

    const result = await getTwinContext('Tell me about Colin.')

    expect(result).toBeNull()
  })

  it('returns null when chunks array is empty (fts path)', async () => {
    mockRetrievePersonalChunks.mockResolvedValue({ chunks: [], retrieval_path: 'fts' })

    const result = await getTwinContext('Colin Alberta')

    expect(result).toBeNull()
  })
})

describe('getTwinContext — vector path similarity filtering', () => {
  it('returns null when all chunks have similarity <= 0.25', async () => {
    mockRetrievePersonalChunks.mockResolvedValue({
      chunks: [makeChunk('c1', 0.1), makeChunk('c2', 0.25), makeChunk('c3', 0.2)],
      retrieval_path: 'vector',
    })

    const result = await getTwinContext('random query')

    expect(result).toBeNull()
    expect(mockBuildContextString).not.toHaveBeenCalled()
  })

  it('returns formatted string when at least one chunk has similarity > 0.25', async () => {
    mockRetrievePersonalChunks.mockResolvedValue({
      chunks: [makeChunk('c1', 0.1), makeChunk('c2', 0.5), makeChunk('c3', 0.8)],
      retrieval_path: 'vector',
    })

    const result = await getTwinContext("What are Colin's goals?")

    expect(result).not.toBeNull()
    expect(result).toContain('## Relevant context from your knowledge base')
    expect(result).toContain('formatted context output')
  })

  it('only passes chunks with similarity > 0.25 to buildContextString', async () => {
    const lowChunk = makeChunk('low', 0.1)
    const borderChunk = makeChunk('border', 0.25)
    const highChunk = makeChunk('high', 0.6)

    mockRetrievePersonalChunks.mockResolvedValue({
      chunks: [lowChunk, borderChunk, highChunk],
      retrieval_path: 'vector',
    })

    await getTwinContext('Colin preferences')

    // Only the chunk with similarity > 0.25 should be passed
    expect(mockBuildContextString).toHaveBeenCalledWith([highChunk])
  })
})

describe('getTwinContext — FTS path', () => {
  it('returns formatted string for FTS path even when similarity is 0', async () => {
    mockRetrievePersonalChunks.mockResolvedValue({
      chunks: [makeChunk('fts1', 0), makeChunk('fts2', 0)],
      retrieval_path: 'fts',
    })

    const result = await getTwinContext('Alberta business')

    expect(result).not.toBeNull()
    expect(result).toContain('## Relevant context from your knowledge base')
    expect(result).toContain('formatted context output')
  })

  it('passes all FTS chunks to buildContextString without similarity filtering', async () => {
    const chunk1 = makeChunk('fts1', 0)
    const chunk2 = makeChunk('fts2', 0)

    mockRetrievePersonalChunks.mockResolvedValue({
      chunks: [chunk1, chunk2],
      retrieval_path: 'fts',
    })

    await getTwinContext('Some keyword query')

    expect(mockBuildContextString).toHaveBeenCalledWith([chunk1, chunk2])
  })
})

describe('getTwinContext — error handling', () => {
  it('returns null when retrievePersonalChunks throws', async () => {
    mockRetrievePersonalChunks.mockRejectedValue(new Error('DB connection failed'))

    const result = await getTwinContext('What is my plan?')

    expect(result).toBeNull()
  })

  it('returns null when buildContextString throws', async () => {
    mockRetrievePersonalChunks.mockResolvedValue({
      chunks: [makeChunk('c1', 0.8)],
      retrieval_path: 'vector',
    })
    mockBuildContextString.mockImplementation(() => {
      throw new Error('formatting error')
    })

    const result = await getTwinContext('What is my plan?')

    expect(result).toBeNull()
  })
})

describe('getTwinContext — output format', () => {
  it('includes the header "## Relevant context from your knowledge base"', async () => {
    mockRetrievePersonalChunks.mockResolvedValue({
      chunks: [makeChunk('c1', 0.9)],
      retrieval_path: 'vector',
    })
    mockBuildContextString.mockReturnValue('[1] Some knowledge chunk')

    const result = await getTwinContext('Colin risk tolerance')

    expect(result).toBe('## Relevant context from your knowledge base\n[1] Some knowledge chunk')
  })

  it('calls retrievePersonalChunks with limit 5', async () => {
    mockRetrievePersonalChunks.mockResolvedValue({ chunks: [], retrieval_path: 'none' })

    await getTwinContext('test query')

    expect(mockRetrievePersonalChunks).toHaveBeenCalledWith('test query', 5)
  })
})
